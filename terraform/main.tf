###############################################################################
# ResumeRight — Infrastructure as Code
# Run:   terraform init && terraform apply
# Nuke:  terraform destroy  (also triggered via GitHub Actions approval gate)
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
# VPC & NETWORKING
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
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, { Name = "${var.app_name}-public-${count.index}" })
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
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

###############################################################################
# SECURITY GROUPS
###############################################################################
resource "aws_security_group" "alb" {
  name   = "${var.app_name}-alb-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "${var.app_name}-alb-sg" })
}

resource "aws_security_group" "ec2" {
  name   = "${var.app_name}-ec2-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
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
# IAM — EC2 can use SSM
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

# Inline policy: read app SSM params + R/W on private uploads bucket.
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
# LAUNCH TEMPLATE
###############################################################################
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_launch_template" "app" {
  name_prefix   = "${var.app_name}-lt-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"

  iam_instance_profile { name = aws_iam_instance_profile.ec2.name }

  vpc_security_group_ids = [aws_security_group.ec2.id]

  # Extra keys (jwt_secret, github_repo, aws_region, uploads_bucket, cors_origins)
  # are passed eagerly so a future bootstrap rewrite that fetches from SSM / writes
  # a full .env works without another Terraform round-trip. The current bootstrap
  # only references mongo_uri/admin_key/app_name; unreferenced keys are ignored.
  user_data = base64encode(templatefile("${path.module}/bootstrap.sh", {
    mongo_uri      = var.mongo_uri
    admin_key      = var.admin_key
    jwt_secret     = var.jwt_secret
    app_name       = var.app_name
    aws_region     = var.aws_region
    uploads_bucket = aws_s3_bucket.uploads.bucket
    cors_origins   = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    github_repo    = var.github_repo
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${var.app_name}-server" })
  }

  lifecycle { create_before_destroy = true }
}

###############################################################################
# ALB
###############################################################################
resource "aws_lb" "app" {
  name               = "${var.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  tags               = local.tags
}

resource "aws_lb_target_group" "app" {
  name     = "${var.app_name}-tg"
  port     = 5000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    # /healthz always returns 200 — doesn't touch the database so Mongo hiccups
    # don't flap the target. `/` queries the DB and can 503, which would make
    # the ALB mark the target unhealthy even when the app process is fine.
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

###############################################################################
# AUTO SCALING GROUP
###############################################################################
resource "aws_autoscaling_group" "app" {
  name                = "${var.app_name}-asg"
  min_size            = 1
  max_size            = 3
  desired_capacity    = 1
  vpc_zone_identifier = aws_subnet.public[*].id

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  target_group_arns         = [aws_lb_target_group.app.arn]
  health_check_type         = "EC2"
  health_check_grace_period = 300

  tag {
    key                 = "Name"
    value               = "${var.app_name}-server"
    propagate_at_launch = true
  }

  lifecycle { create_before_destroy = true }
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

# Upload frontend files
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
# CLOUDFRONT
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

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb-backend"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE","GET","HEAD","OPTIONS","PATCH","POST","PUT"]
    cached_methods         = ["GET","HEAD"]
    target_origin_id       = "alb-backend"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
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
output "alb_dns"         { value = aws_lb.app.dns_name }
output "s3_bucket"       { value = aws_s3_bucket.frontend.bucket }
output "uploads_bucket"  { value = aws_s3_bucket.uploads.bucket }
output "cf_frontend_id"  { value = aws_cloudfront_distribution.frontend.id }
output "cf_api_id"       { value = aws_cloudfront_distribution.api.id }
