#!/bin/bash
# deploy_social.sh — create or update the traveleria-social Lambda.
#
# Run in AWS CloudShell, from traveleria-backend:
#     bash scripts/deploy_social.sh
#
# Like deploy_wallet.sh, this only creates and updates. It deletes nothing
# and never touches API Gateway, so the invoke URL cannot change here. Run
# scripts/add_routes.sh afterwards to wire /social/... paths to it.
#
# Environment is copied from an existing function rather than re-typed here,
# so DATABASE_URL, the Cognito settings, and WALLET_BUCKET (post images live
# in the same bucket as wallet documents) all carry over automatically.
# update-function-configuration --environment REPLACES the whole variable
# map, so this never prints it: the values include the database password.

set -euo pipefail

REGION="us-east-1"
FUNCTION="traveleria-social"
SOURCE_FUNCTION="traveleria-users"   # where we copy DATABASE_URL / Cognito / WALLET_BUCKET from

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/LabRole"

echo "Account: $ACCOUNT_ID"
echo ""

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
rm -rf staging_social
cp -r deps staging_social
cp -r shared staging_social/shared
cp lambdas/social/handler.py staging_social/lambda_function.py
(cd staging_social && zip -qr ../zips/lambda_social.zip .)
rm -rf staging_social

# ── Environment, copied from an existing function ──────────────────────────
BASE_ENV=$(aws lambda get-function-configuration \
    --function-name "$SOURCE_FUNCTION" --region "$REGION" \
    --query 'Environment.Variables' --output json)

# ── Create or update ──────────────────────────────────────────────────────
if aws lambda get-function --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
    echo "Updating $FUNCTION..."
    aws lambda update-function-code \
        --function-name "$FUNCTION" --zip-file "fileb://zips/lambda_social.zip" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,status:LastUpdateStatus}'
    aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"
    aws lambda update-function-configuration \
        --function-name "$FUNCTION" --timeout 30 \
        --environment "{\"Variables\":${BASE_ENV}}" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,status:LastUpdateStatus}'
else
    echo "Creating $FUNCTION..."
    aws lambda create-function \
        --function-name "$FUNCTION" \
        --runtime python3.11 \
        --role "$ROLE_ARN" \
        --handler lambda_function.lambda_handler \
        --zip-file "fileb://zips/lambda_social.zip" \
        --timeout 30 \
        --environment "{\"Variables\":${BASE_ENV}}" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,state:State}'
fi

aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

echo ""
echo "Done. Now run:  bash scripts/add_routes.sh"
echo "(it wires /social/posts and friends, which it skips until this"
echo " function exists)"
