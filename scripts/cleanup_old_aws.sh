#!/usr/bin/env bash
# One-shot cleanup of the ORPHANED ResumeRight AWS resources from previous
# manual deploys / failed Terraform runs. Run ONCE before the first green
# pipeline run.
#
# Safety: this script hardcodes a match pattern of "resumeright-*" so it
# cannot accidentally touch your state bucket (`devops-tf-state-psp`).
#
# Usage:
#   chmod +x scripts/cleanup_old_aws.sh
#   ./scripts/cleanup_old_aws.sh

set -euo pipefail

# Force a clean region regardless of what the shell env / ~/.aws/config says.
# (Previous runs hit "Provided region_name 'ap-'" because something truncated it.)
unset AWS_DEFAULT_REGION AWS_REGION
export AWS_REGION="ap-south-1"
export AWS_DEFAULT_REGION="ap-south-1"
REGION="$AWS_REGION"
APP="resumeright"

echo "Region: $REGION"
echo "Prefix: $APP"
echo "Caller:"
aws sts get-caller-identity --output table
echo

confirm() {
  read -rp "$1 (yes/NO): " ans
  [ "$ans" = "yes" ] || { echo "aborted."; exit 0; }
}

confirm "This will DELETE all ResumeRight AWS resources. Continue?"

############################################################
# CloudFront — list only. Disable + delete in console (2 clicks).
# Doing it via CLI is fiddly because the update call requires feeding back the
# FULL config and any field drift causes InvalidIfMatchVersion.
############################################################
echo "==> CloudFront distributions to delete manually:"
aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, '$APP') || (Origins.Items[0].DomainName != null && contains(Origins.Items[0].DomainName, '$APP')) || (Origins.Items[0].Id != null && contains(Origins.Items[0].Id, '$APP'))].[Id,DomainName,Comment,Enabled]" \
  --output table 2>/dev/null || echo "  (none or unable to list)"
echo
echo "  For each ID above:"
echo "    AWS Console -> CloudFront -> Distributions -> select -> Disable -> wait ~15 min -> Delete."
echo "  Backend + frontend of new stack will create fresh distributions."
echo

############################################################
# Auto Scaling Group + Launch Template
############################################################
echo "==> ASG + Launch Template"
aws autoscaling delete-auto-scaling-group \
  --auto-scaling-group-name "${APP}-asg" \
  --force-delete --region "$REGION" 2>/dev/null && echo "  asg deleted" || echo "  asg not found"

LT_IDS=$(aws ec2 describe-launch-templates --region "$REGION" \
  --filters "Name=launch-template-name,Values=${APP}-lt-*" \
  --query 'LaunchTemplates[].LaunchTemplateId' --output text 2>/dev/null || true)
for id in $LT_IDS; do
  [ -z "$id" ] && continue
  aws ec2 delete-launch-template --launch-template-id "$id" --region "$REGION" \
    && echo "  launch template $id deleted"
done

############################################################
# ALB + target group
############################################################
echo "==> ALB"
ALB_ARN=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --names "${APP}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
  aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --region "$REGION"
  echo "  alb deleted, waiting 30s for propagation..."
  sleep 30
else
  echo "  alb not found"
fi

TG_ARN=$(aws elbv2 describe-target-groups --region "$REGION" \
  --names "${APP}-tg" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ -n "$TG_ARN" ] && [ "$TG_ARN" != "None" ]; then
  aws elbv2 delete-target-group --target-group-arn "$TG_ARN" --region "$REGION"
  echo "  target group deleted"
else
  echo "  target group not found"
fi

############################################################
# SSM Parameters
############################################################
echo "==> SSM params"
for p in MONGO_URI ADMIN_KEY JWT_SECRET; do
  aws ssm delete-parameter --name "/${APP}/${p}" --region "$REGION" 2>/dev/null \
    && echo "  /${APP}/${p} deleted" || echo "  /${APP}/${p} not found"
done

############################################################
# S3 buckets — empty then delete. Only touches resumeright-* buckets.
############################################################
echo "==> S3 buckets (resumeright-* only)"
BUCKETS=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, '${APP}-')].Name" --output text)
for b in $BUCKETS; do
  # triple safety: never touch tfstate bucket
  if [[ "$b" == *tfstate* || "$b" == devops-* ]]; then
    echo "  SKIPPING $b (looks like state bucket)"
    continue
  fi
  echo "  emptying $b ..."
  aws s3api delete-bucket-policy --bucket "$b" 2>/dev/null || true
  aws s3 rm "s3://$b" --recursive 2>/dev/null || true
  # delete all versions (versioned buckets need this)
  aws s3api list-object-versions --bucket "$b" \
    --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' 2>/dev/null \
    | jq -c 'if .Objects == null then empty else . end' \
    | while read -r payload; do
        [ -n "$payload" ] && aws s3api delete-objects --bucket "$b" --delete "$payload" >/dev/null
      done
  aws s3api list-object-versions --bucket "$b" \
    --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' 2>/dev/null \
    | jq -c 'if .Objects == null then empty else . end' \
    | while read -r payload; do
        [ -n "$payload" ] && aws s3api delete-objects --bucket "$b" --delete "$payload" >/dev/null
      done
  aws s3api delete-bucket --bucket "$b" --region "$REGION" \
    && echo "  deleted $b" || echo "  FAILED to delete $b"
done

############################################################
# IAM (role, instance profile, policies)
############################################################
echo "==> IAM"
ROLE="${APP}-ec2-role"
PROFILE="${APP}-ec2-profile"

aws iam delete-role-policy --role-name "$ROLE" --policy-name "${APP}-ec2-inline" 2>/dev/null || true
aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
aws iam remove-role-from-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" 2>/dev/null || true
aws iam delete-instance-profile --instance-profile-name "$PROFILE" 2>/dev/null || true
aws iam delete-role --role-name "$ROLE" 2>/dev/null || true
echo "  iam cleaned (or already absent)"

############################################################
# Security groups (after ALB + ASG gone they're deletable)
############################################################
echo "==> Security groups"
for sg_name in "${APP}-alb-sg" "${APP}-ec2-sg"; do
  SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
    --filters "Name=group-name,Values=$sg_name" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
  if [ -n "$SG_ID" ] && [ "$SG_ID" != "None" ]; then
    aws ec2 delete-security-group --group-id "$SG_ID" --region "$REGION" 2>/dev/null \
      && echo "  $sg_name deleted" || echo "  $sg_name not deletable yet"
  fi
done

############################################################
# VPC left over from previous apply (if any). Terraform creates a fresh one.
# We only delete a VPC whose Name tag matches our app.
############################################################
echo "==> VPC (tagged ${APP})"
VPC_IDS=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=tag:Project,Values=${APP}" \
  --query 'Vpcs[].VpcId' --output text 2>/dev/null || true)
for vpc in $VPC_IDS; do
  [ -z "$vpc" ] && continue
  echo "  vpc $vpc (delete manually in console if Terraform didn't own it)"
done

echo
echo "Done (excluding CloudFront — disable/delete those manually)."
echo
echo "Verify:"
echo "  aws elbv2 describe-load-balancers --region $REGION --query 'LoadBalancers[?LoadBalancerName==\`${APP}-alb\`]' --output text"
echo "  aws s3api list-buckets --query \"Buckets[?starts_with(Name, '${APP}-')].Name\" --output text"
echo
echo "Once all clear AND CloudFront distributions are deleted, push to main."
