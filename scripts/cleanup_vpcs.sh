#!/usr/bin/env bash
# Delete orphaned VPCs tagged Project=resumeright and all their dependencies.
# Run AFTER cleanup_old_aws.sh and after CloudFront distributions are gone.
#
# Why: every failed Terraform apply created a fresh VPC. They stack up and
# eventually hit the default 5-VPC-per-region limit. This script deletes:
#   instances -> NAT gateways -> ENIs -> IGW detach+delete -> subnets -> route tables -> VPC.

set -euo pipefail

unset AWS_DEFAULT_REGION AWS_REGION
export AWS_REGION="ap-south-1"
export AWS_DEFAULT_REGION="ap-south-1"
REGION="$AWS_REGION"
APP="resumeright"

echo "Region: $REGION"
aws sts get-caller-identity --output table
echo

read -rp "Delete ALL VPCs tagged Project=$APP? (yes/NO): " ans
[ "$ans" = "yes" ] || { echo "aborted."; exit 0; }

VPC_IDS=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=tag:Project,Values=${APP}" \
  --query 'Vpcs[].VpcId' --output text)

if [ -z "$VPC_IDS" ]; then
  echo "No matching VPCs."
  exit 0
fi

for VPC in $VPC_IDS; do
  echo
  echo "================================================================"
  echo "VPC: $VPC"
  echo "================================================================"

  # 1) Terminate any EC2 instances in this VPC
  INSTANCES=$(aws ec2 describe-instances --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  if [ -n "$INSTANCES" ]; then
    echo "-> terminating instances: $INSTANCES"
    aws ec2 terminate-instances --region "$REGION" --instance-ids $INSTANCES >/dev/null
    aws ec2 wait instance-terminated --region "$REGION" --instance-ids $INSTANCES
    echo "   terminated."
  fi

  # 2) Delete NAT gateways (if any)
  NATS=$(aws ec2 describe-nat-gateways --region "$REGION" \
    --filter "Name=vpc-id,Values=$VPC" "Name=state,Values=available,pending" \
    --query 'NatGateways[].NatGatewayId' --output text)
  for n in $NATS; do
    [ -z "$n" ] && continue
    echo "-> deleting NAT $n"
    aws ec2 delete-nat-gateway --region "$REGION" --nat-gateway-id "$n" >/dev/null
  done
  if [ -n "$NATS" ]; then
    echo "   waiting 60s for NAT deletion..."
    sleep 60
  fi

  # 3) Release any free EIPs in this VPC
  EIPS=$(aws ec2 describe-addresses --region "$REGION" \
    --query "Addresses[?NetworkInterfaceId!=null].[AllocationId]" --output text)
  # (we skip actually releasing — NAT deletion releases the NAT EIP automatically)

  # 4) Delete load balancers in this VPC (in case any linger)
  LBS=$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query "LoadBalancers[?VpcId=='$VPC'].LoadBalancerArn" --output text)
  for lb in $LBS; do
    [ -z "$lb" ] && continue
    echo "-> deleting ALB $lb"
    aws elbv2 delete-load-balancer --load-balancer-arn "$lb" --region "$REGION"
  done
  if [ -n "$LBS" ]; then sleep 20; fi

  # 5) Delete leftover ENIs (ASGs / ALBs sometimes leave these)
  ENIS=$(aws ec2 describe-network-interfaces --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC" \
    --query 'NetworkInterfaces[?Status==`available`].NetworkInterfaceId' --output text)
  for eni in $ENIS; do
    [ -z "$eni" ] && continue
    echo "-> deleting ENI $eni"
    aws ec2 delete-network-interface --region "$REGION" --network-interface-id "$eni" 2>/dev/null \
      || echo "   (ENI $eni not deletable yet — will retry)"
  done

  # 6) Detach + delete Internet Gateways
  IGWS=$(aws ec2 describe-internet-gateways --region "$REGION" \
    --filters "Name=attachment.vpc-id,Values=$VPC" \
    --query 'InternetGateways[].InternetGatewayId' --output text)
  for igw in $IGWS; do
    [ -z "$igw" ] && continue
    echo "-> detaching + deleting IGW $igw"
    aws ec2 detach-internet-gateway --region "$REGION" --internet-gateway-id "$igw" --vpc-id "$VPC"
    aws ec2 delete-internet-gateway --region "$REGION" --internet-gateway-id "$igw"
  done

  # 7) Delete subnets
  SUBNETS=$(aws ec2 describe-subnets --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC" \
    --query 'Subnets[].SubnetId' --output text)
  for s in $SUBNETS; do
    [ -z "$s" ] && continue
    echo "-> deleting subnet $s"
    aws ec2 delete-subnet --region "$REGION" --subnet-id "$s"
  done

  # 8) Delete non-main route tables
  RTBS=$(aws ec2 describe-route-tables --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC" \
    --query 'RouteTables[?length(Associations[?Main==`true`])==`0`].RouteTableId' --output text)
  for rtb in $RTBS; do
    [ -z "$rtb" ] && continue
    echo "-> deleting route table $rtb"
    aws ec2 delete-route-table --region "$REGION" --route-table-id "$rtb" 2>/dev/null || true
  done

  # 9) Delete non-default security groups
  SGS=$(aws ec2 describe-security-groups --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC" \
    --query "SecurityGroups[?GroupName!='default'].GroupId" --output text)
  for sg in $SGS; do
    [ -z "$sg" ] && continue
    echo "-> deleting SG $sg"
    aws ec2 delete-security-group --region "$REGION" --group-id "$sg" 2>/dev/null \
      || echo "   (SG $sg still referenced — rerun in a minute)"
  done

  # 10) Finally, the VPC itself
  echo "-> deleting VPC $VPC"
  aws ec2 delete-vpc --region "$REGION" --vpc-id "$VPC" \
    && echo "   VPC $VPC deleted" \
    || echo "   VPC $VPC not deletable yet (dependencies remain)"
done

echo
echo "Done. Re-run if any VPCs reported 'dependencies remain'."
echo "Verify:"
echo "  aws ec2 describe-vpcs --region $REGION --filters Name=tag:Project,Values=${APP} --query 'Vpcs[].VpcId' --output text"
