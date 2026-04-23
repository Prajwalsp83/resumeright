###############################################################################
# ResumeRight — Infrastructure as Code
# Minimal single-EC2 stack. No ALB, no ASG, no NAT Gateway.
#
# Run:   terraform init && terraform apply
# Nuke:  terraform destroy  (also triggered via GitHub Actions approval gate)
#
# Costs at idle (ap-south-1):
#   t3.micro          ~$7.6/mo  (free-tier eligible for 12 months)
#   Elastic IP        $0 when attached; $3.6/mo if unattached
#   CloudFront (x2)   ~$0 at low traffic (pay per request, HTTPS termination)
#   S3 + SSM params   cents
# Total: ~$8/mo during free tier, ~$15/mo after.
###############################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws",    version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.5" }
  }

  # State is stored remotely in S3 so every pipeline run sees the same state.
  # The bucket is passed via `-backend-config` at init time (see the workflow),
  # not hardcoded here, so the same module works for multiple environments.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

###############################################################################
# VARIABLES
###############################################################################
variable "aws_region" { default = "ap-south-1" }
variable "app_name"   { default = "resumeright" }

variable "mongo_uri" {
  description = "MongoDB Atlas connection string"
  sensitive   = true
}
variable "admin_key" {
  description = "Admin bootstrap key"
  sensitive   = true
}
variable "jwt_secret" {
  description = "Secret used to sign JWTs (min 32 chars)"
  sensitive   = true
}
variable "github_repo" {
  description = "HTTPS URL of the repo (e.g. https://github.com/user/resumeright.git)"
  type        = string
  default     = ""
}

locals {
  tags = {
    Project     = var.app_name
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

###############################################################################
# SSM PARAMETER STORE — secrets live here (not in tfstate, not in user-data)
###############################################################################
resource "aws_ssm_parameter" "mongo_uri" {
  name  = "/${var.app_name}/MONGO_URI"
  type  = "SecureString"
  value = var.mongo_uri
  tags  = local.tags
}

resource "aws_ssm_parameter" "admin_key" {
  name  = "/${var.app_name}/ADMIN_KEY"
  type  = "SecureString"
  value = var.admin_key
  tags  = local.tags
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/${var.app_name}/JWT_SECRET"
  type  = "SecureString"
  value = var.jwt_secret
  tags  = local.tags
}

data "aws_caller_identity" "me" {}

###############################################################################
# VPC & NETWORKING — single public subnet is enough for a single EC2.
###############################################################################
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(local.tags, { Name = "${var.app_name}-vpc" })
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${var.app_name}-igw" })
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.0.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags = merge(local.tags, { Name = "${var.app_name}-public" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = merge(local.tags, { Name = "${var.app_name}-rt" })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

###############################################################################
# SECURITY GROUP
# Ingress:
#   5000  → 0.0.0.0/0  (CloudFront fronts it; EC2 direct is only for debugging)
#   22    → 0.0.0.0/0  (SSH optional — remove if you only use SSM Session Mgr)
# Egress: all (needed for Atlas, npm, git, SSM).
###############################################################################
resource "aws_security_group" "ec2" {
  name   = "${var.app_name}-ec2-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "App port (CloudFront origin)"
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH (optional - prefer SSM Session Manager)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.app_name}-ec2-sg" })
}

###############################################################################
# IAM — EC2 can use SSM + read app secrets + R/W uploads bucket
###############################################################################
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.app_name}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "ec2_inline" {
  statement {
    sid     = "ReadAppParams"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.me.account_id}:parameter/${var.app_name}/*"
    ]
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
  }
  statement {
    sid       = "UploadsBucketRw"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/*"]
  }
  statement {
    sid       = "UploadsBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.uploads.arn]
  }
}

resource "aws_iam_role_policy" "ec2_inline" {
  name   = "${var.app_name}-ec2-inline"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_inline.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.app_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}

###############################################################################
# EC2 INSTANCE
# Plain aws_instance — no ASG, no launch template. Single box, smallest AMI.
# If it dies, `terraform apply` recreates it (ok for MVP; revisit post-revenue).
###############################################################################
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # bootstrap.sh is intentionally minimal — it just ensures the SSM agent is
  # running so the pipeline can target this instance. The real deploy (node,
  # npm, git, pm2, repo, .env from SSM, pm2 start) runs from GitHub Actions
  # via SSM RunCommand and is idempotent.
  user_data = file("${path.module}/bootstrap.sh")

  # Changing user_data should NOT force instance replacement — the pipeline
  # handles redeploys via SSM, we don't need to cycle the box for code changes.
  user_data_replace_on_change = false

  root_block_device {
    volume_size = 16
    volume_type = "gp3"
    encrypted   = true
  }

  # Free auto-recovery: if the underlying host dies, AWS will restart the
  # instance on healthy hardware. Doesn't protect against app-level crashes
  # (pm2 handles those) but covers hypervisor failures.
  maintenance_options {
    auto_recovery = "default"
  }

  tags = merge(local.tags, { Name = "${var.app_name}-server" })
}

###############################################################################
# ELASTIC IP — stable public IP so Atlas allowlist stays valid across deploys.
# The EIP persists across `terraform apply`; only `terraform destroy` releases
# it. After the first apply, add this IP to Atlas → Network Access once.
###############################################################################
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.app_name}-eip" })
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

###############################################################################
# S3 — Frontend hosting
###############################################################################
resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.app_name}-website-${random_id.suffix.hex}"
  force_destroy = true
  tags          = local.tags
}

resource "random_id" "suffix" { byte_length = 4 }

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
  error_document { key = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket     = aws_s3_bucket.frontend.id
  depends_on = [aws_s3_bucket_public_access_block.frontend]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })
}

resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "index.html"
  source       = "${path.module}/../frontend/index.html"
  content_type = "text/html"
  etag         = filemd5("${path.module}/../frontend/index.html")
}

resource "aws_s3_object" "admin" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "admin.html"
  source       = "${path.module}/../frontend/admin.html"
  content_type = "text/html"
  etag         = filemd5("${path.module}/../frontend/admin.html")
}

###############################################################################
# S3 — Resume uploads (PRIVATE, served via pre-signed URLs from the API)
###############################################################################
resource "aws_s3_bucket" "uploads" {
  bucket        = "${var.app_name}-uploads-${random_id.suffix.hex}"
  force_destroy = true
  tags          = local.tags
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "expire-unprocessed"
    status = "Enabled"
    filter {}
    expiration { days = 180 }
  }
}

###############################################################################
# CLOUDFRONT — frontend (S3 static site) + API (EC2 via EIP)
# CloudFront gives us free TLS termination; the browser never touches the
# backend over plain HTTP. We keep it because it's pay-per-request (near $0
# at low traffic) and it's the only reason the app can use HTTPS without
# managing certs on the EC2.
###############################################################################
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  tags                = local.tags

  origin {
    domain_name = aws_s3_bucket_website_configuration.frontend.website_endpoint
    origin_id   = "s3-frontend"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_cloudfront_distribution" "api" {
  enabled     = true
  price_class = "PriceClass_200"
  tags        = local.tags

  # Origin = EIP's stable public DNS name. That hostname resolves to the same
  # IP forever (EIP is static), so CloudFront keeps working across EC2
  # replacements as long as the EIP stays associated.
  origin {
    domain_name = aws_eip.app.public_dns
    origin_id   = "ec2-backend"
    custom_origin_config {
      http_port              = 5000
      https_port             = 443 # unused (origin_protocol_policy = http-only)
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE","GET","HEAD","OPTIONS","PATCH","POST","PUT"]
    cached_methods         = ["GET","HEAD"]
    target_origin_id       = "ec2-backend"
    viewer_protocol_policy = "redirect-to-https"
    # CachingDisabled — never cache API responses.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AllViewerExceptHostHeader — forward Authorization, cookies, query strings,
    # and all other viewer headers, but let CloudFront set Host = origin host
    # (the EIP DNS). The Node backend doesn't care about Host header, so this
    # keeps JWT auth (Authorization header) working.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

###############################################################################
# OUTPUTS
###############################################################################
output "frontend_url"    { value = "https://${aws_cloudfront_distribution.frontend.domain_name}" }
output "api_url"         { value = "https://${aws_cloudfront_distribution.api.domain_name}" }
output "s3_bucket"       { value = aws_s3_bucket.frontend.bucket }
output "uploads_bucket"  { value = aws_s3_bucket.uploads.bucket }
output "cf_frontend_id"  { value = aws_cloudfront_distribution.frontend.id }
output "cf_api_id"       { value = aws_cloudfront_distribution.api.id }

# EC2 identity — the pipeline uses instance_id to target SSM RunCommand.
output "instance_id"     { value = aws_instance.app.id }

# Stable public IP. Add this to MongoDB Atlas → Network Access once; it stays
# the same across every `terraform apply` (only `terraform destroy` releases
# it). This is what Atlas sees as the client IP when the backend connects.
output "ec2_public_ip"   { value = aws_eip.app.public_ip }
output "ec2_public_dns"  { value = aws_eip.app.public_dns }
