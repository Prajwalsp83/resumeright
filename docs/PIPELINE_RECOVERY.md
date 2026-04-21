# Pipeline Recovery — one-time cleanup

The first pipeline run failed because (1) state wasn't persisted between runs, so
Terraform tried to re-create resources that already exist in AWS, and (2) the
`github-actions` IAM user doesn't have permission to create IAM roles. Both are
now fixed in code (S3 backend added) but you need to do these one-time manual
steps before the next push.

Do them in order. Total time ~10 min.

---

## Step 1 — Broaden IAM permissions for `github-actions` user

Console → IAM → Users → **github-actions** → Add permissions → Attach policies
directly → select **AdministratorAccess** → Next → Add permissions.

> For a pre-revenue solo-founder setup, `AdministratorAccess` is the pragmatic
> choice. You can tighten it later once the app is stable. If you want to be
> more restrictive right away, use this minimum set instead: `AmazonEC2FullAccess`,
> `AmazonS3FullAccess`, `AmazonSSMFullAccess`, `CloudFrontFullAccess`,
> `IAMFullAccess`, `AutoScalingFullAccess`, `ElasticLoadBalancingFullAccess`,
> `AmazonVPCFullAccess`, `AWSKeyManagementServicePowerUser`.

---

## Step 2 — Create an S3 bucket for Terraform state

State lives in a dedicated bucket so every pipeline run reads/writes the same
state. Pick a globally-unique name. I'll use `resumeright-tfstate-<random>` as
an example — replace `<random>` with any 6-char suffix.

```bash
aws s3api create-bucket \
  --bucket resumeright-tfstate-a1b2c3 \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

aws s3api put-bucket-versioning \
  --bucket resumeright-tfstate-a1b2c3 \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket resumeright-tfstate-a1b2c3 \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket resumeright-tfstate-a1b2c3 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Then add the bucket name as a GitHub secret:

- Settings → Secrets and variables → Actions → **New repository secret**
- Name: `TF_STATE_BUCKET`
- Value: `resumeright-tfstate-a1b2c3` (or whatever you chose)

---

## Step 3 — Delete the orphaned AWS resources

These exist in AWS from the failed run but aren't in state. Clean slate is
easier than importing.

```bash
REGION=ap-south-1

# SSM parameters (the easy three)
aws ssm delete-parameter --name /resumeright/MONGO_URI  --region $REGION
aws ssm delete-parameter --name /resumeright/ADMIN_KEY  --region $REGION
aws ssm delete-parameter --name /resumeright/JWT_SECRET --region $REGION

# Target Group: find its ARN, then delete (it may have no listener yet)
TG_ARN=$(aws elbv2 describe-target-groups \
  --names resumeright-tg --region $REGION \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
echo "TG: $TG_ARN"

# ALB: find its ARN
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names resumeright-alb --region $REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
echo "ALB: $ALB_ARN"

# Delete the ALB first (it may own listeners pointing at the TG)
aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --region $REGION

# Wait 30s for ALB to finish deleting, then the TG
sleep 30
aws elbv2 delete-target-group --target-group-arn "$TG_ARN" --region $REGION
```

If other resources also got partially-created (EC2 role, security groups, S3
buckets), delete them too:

```bash
# IAM role (if it exists)
aws iam delete-role-policy --role-name resumeright-ec2-role --policy-name resumeright-ec2-inline 2>/dev/null || true
aws iam detach-role-policy --role-name resumeright-ec2-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
aws iam remove-role-from-instance-profile --instance-profile-name resumeright-ec2-profile --role-name resumeright-ec2-role 2>/dev/null || true
aws iam delete-instance-profile --instance-profile-name resumeright-ec2-profile 2>/dev/null || true
aws iam delete-role --role-name resumeright-ec2-role 2>/dev/null || true

# Check for S3 buckets and delete if empty (careful — don't delete the tfstate bucket!)
aws s3 ls | grep -E 'resumeright-(website|uploads)-' || echo "no orphan buckets"
# If any show up, empty + remove them:
# aws s3 rm s3://<name> --recursive && aws s3api delete-bucket --bucket <name>
```

Quick sanity check — confirm AWS is clean:

```bash
aws elbv2 describe-load-balancers --region $REGION --query 'LoadBalancers[?LoadBalancerName==`resumeright-alb`]' --output text
aws ssm describe-parameters --region $REGION --parameter-filters "Key=Name,Option=BeginsWith,Values=/resumeright/" --query 'Parameters[].Name' --output text
```

Both should print nothing.

---

## Step 4 — Push and re-run the pipeline

```bash
cd /path/to/resumeright
git add -A
git commit -m "add s3 backend for terraform state"
git push origin main
```

Watch GitHub → Actions. This time the `terraform-apply` job will:

1. Init against the S3 backend (empty state — since nothing is in AWS either, they're in sync)
2. Plan + apply cleanly
3. Persist state to S3 for all future runs

---

## What changed in the code

- `terraform/main.tf` — added `backend "s3" {}` block
- `.github/workflows/deploy.yml`
  - `terraform init` now takes `-backend-config` flags (bucket, key, region, encrypt)
  - removed the `upload-artifact`/`download-artifact` state dance (no longer needed)
  - `terraform-destroy` job now inits against the same S3 backend

---

## Summary — GitHub secrets needed

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user with AdministratorAccess (after step 1) |
| `AWS_SECRET_ACCESS_KEY` | matching secret |
| `TF_STATE_BUCKET` | **new** — the bucket from step 2 |
| `MONGO_URI` | rotated Atlas connection string |
| `ADMIN_KEY` | fresh random |
| `JWT_SECRET` | must match `terraform/terraform.tfvars` |
