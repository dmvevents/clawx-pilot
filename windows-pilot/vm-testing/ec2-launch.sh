#!/usr/bin/env bash
# EC2 Windows launch — DO NOT RUN until Anton confirms keypair name + go-ahead.
# Cost: ~$0.10/hr while running (t3.large + Windows license), ~$5/mo stopped (50GB EBS).
set -euo pipefail

# ---- CONFIG (fill in before running) --------------------------------------
REGION="us-east-2"                                # same as Anton's existing 3.139.145.129
INSTANCE_TYPE="t3.large"                          # 2 vCPU / 8GB — enough for Electron install
KEY_NAME="${CLAWX_WINVM_KEY:-REPLACE_ME}"         # existing keypair in us-east-2
SG_ID="${CLAWX_WINVM_SG:-REPLACE_ME}"             # security group ID (see sg-rdp.json)
INSTANCE_NAME="clawx-winvm-installer-test"
VOLUME_GB=50

# ---- AMI resolution (Windows Server 2022 Full Base, latest) ---------------
AMI_PARAM="/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base"

# ---- Pre-flight -----------------------------------------------------------
if [[ "$KEY_NAME" == "REPLACE_ME" || "$SG_ID" == "REPLACE_ME" ]]; then
  echo "ERROR: set CLAWX_WINVM_KEY and CLAWX_WINVM_SG env vars (or edit this script)." >&2
  exit 1
fi

echo "Resolving latest Windows Server 2022 AMI in $REGION ..."
AMI_ID=$(aws ssm get-parameters \
  --region "$REGION" \
  --names "$AMI_PARAM" \
  --query 'Parameters[0].Value' \
  --output text)
echo "AMI: $AMI_ID"

# ---- Launch --------------------------------------------------------------
aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
  --user-data file://"$(dirname "$0")/bootstrap-userdata.ps1" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Purpose,Value=clawx-installer-repro}]" \
  --query 'Instances[0].{Id:InstanceId,Az:Placement.AvailabilityZone}' \
  --output table

cat <<'EOF'

Next steps after launch:
  1. Wait ~4 min for Windows to boot.
  2. Get admin password:
       aws ec2 get-password-data --region us-east-2 --instance-id <ID> \
         --priv-launch-key ~/.ssh/<KEY_NAME>.pem --query PasswordData --output text
  3. Grab public DNS:
       aws ec2 describe-instances --region us-east-2 --instance-ids <ID> \
         --query 'Reservations[].Instances[].PublicDnsName' --output text
  4. RDP from Mac with Microsoft Remote Desktop.
  5. When done: `aws ec2 stop-instances --instance-ids <ID>` (keeps disk for next run).
  6. After confirming fix: snapshot AMI for future clean-slate reverts.
EOF
