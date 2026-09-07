#!/bin/bash
# deploy_wallet.sh — create or update the traveleria-wallet Lambda, and give
# it and traveleria-users the bucket name they need.
#
# Run in AWS CloudShell, from traveleria-backend:
#     bash scripts/deploy_wallet.sh
#
# Optionally override the bucket:
#     WALLET_BUCKET=my-bucket bash scripts/deploy_wallet.sh
#
# Like add_routes.sh, this only creates and updates. It deletes nothing and
# never touches API Gateway, so the invoke URL cannot change here.
#
# Two things this script is careful about:
#
#   1. update-function-configuration --environment REPLACES the whole variable
#      map. Adding WALLET_BUCKET naively would wipe DATABASE_URL and the
#      Cognito settings. Every write below merges into the existing map.
#   2. It never prints an environment block. The values include the database
#      password and API keys, and `aws lambda update-function-code` returning
#      them in full is how they leaked once already.

set -euo pipefail

REGION="us-east-1"
FUNCTION="traveleria-wallet"
SOURCE_FUNCTION="traveleria-users"   # where we copy DATABASE_URL / Cognito from

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${WALLET_BUCKET:-traveleria-wallet-${ACCOUNT_ID}}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/LabRole"

echo "Account: $ACCOUNT_ID"
echo "Bucket:  $BUCKET"
echo ""

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    echo "ERROR: bucket '$BUCKET' not found or not readable from this account."
    echo "Create it first:  aws s3 mb s3://${BUCKET} --region ${REGION}"
    exit 1
fi

# ── Build the zip ─────────────────────────────────────────────────────────
if [ ! -d deps ]; then
    echo "Installing dependencies..."
    pip install --quiet --target ./deps \
        --platform manylinux2014_x86_64 --python-version 3.11 \
        --only-binary=:all: \
        "psycopg[binary]" "PyJWT[crypto]" python-dotenv typing_extensions
fi
# boto3 is preinstalled in the Lambda runtime, so it is deliberately not
# bundled here — shipping our own copy would only add weight and drift.

echo "Building zip..."
mkdir -p zips
rm -rf staging_wallet
cp -r deps staging_wallet
cp -r shared staging_wallet/shared
cp lambdas/wallet/handler.py staging_wallet/lambda_function.py
(cd staging_wallet && zip -qr ../zips/lambda_wallet.zip .)
rm -rf staging_wallet

# ── Environment, copied from an existing function and extended ────────────
# Piped straight into the next call; never echoed.
BASE_ENV=$(aws lambda get-function-configuration \
    --function-name "$SOURCE_FUNCTION" --region "$REGION" \
    --query 'Environment.Variables' --output json)

WALLET_ENV=$(echo "$BASE_ENV" | jq -c --arg b "$BUCKET" '. + {WALLET_BUCKET: $b}')

# ── Create or update ──────────────────────────────────────────────────────
if aws lambda get-function --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
    echo "Updating $FUNCTION..."
    aws lambda update-function-code \
        --function-name "$FUNCTION" --zip-file "fileb://zips/lambda_wallet.zip" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,status:LastUpdateStatus}'
    aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"
    aws lambda update-function-configuration \
        --function-name "$FUNCTION" --timeout 30 \
        --environment "{\"Variables\":${WALLET_ENV}}" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,status:LastUpdateStatus}'
else
    echo "Creating $FUNCTION..."
    aws lambda create-function \
        --function-name "$FUNCTION" \
        --runtime python3.11 \
        --role "$ROLE_ARN" \
        --handler lambda_function.lambda_handler \
        --zip-file "fileb://zips/lambda_wallet.zip" \
        --timeout 30 \
        --environment "{\"Variables\":${WALLET_ENV}}" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,state:State}'
fi

aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

# ── traveleria-users also needs the bucket, for the profile photo ─────────
echo ""
echo "Adding WALLET_BUCKET to $SOURCE_FUNCTION (merging, not replacing)..."
USERS_ENV=$(echo "$BASE_ENV" | jq -c --arg b "$BUCKET" '. + {WALLET_BUCKET: $b}')
aws lambda update-function-configuration \
    --function-name "$SOURCE_FUNCTION" \
    --environment "{\"Variables\":${USERS_ENV}}" \
    --region "$REGION" --no-cli-pager \
    --query '{name:FunctionName,status:LastUpdateStatus}'

echo ""
echo "Done. Now run:  bash scripts/add_routes.sh"
echo "(it wires /wallet and /wallet/{document_id}, which it skips until this"
echo " function exists)"
