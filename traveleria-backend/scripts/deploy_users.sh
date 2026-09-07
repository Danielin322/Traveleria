#!/bin/bash
# deploy_users.sh — update just the traveleria-users Lambda's code.
#
# Run in AWS CloudShell, from traveleria-backend:
#     bash scripts/deploy_users.sh
#
# Code only — no --environment flag anywhere in this script — so it cannot
# touch or wipe existing environment variables (DATABASE_URL, Cognito,
# WALLET_BUCKET). Use this whenever lambdas/users/handler.py changes but the
# function's configuration does not.

set -euo pipefail

REGION="us-east-1"
FUNCTION="traveleria-users"

if [ ! -d deps ]; then
    echo "Installing dependencies..."
    pip install --quiet --target ./deps \
        --platform manylinux2014_x86_64 --python-version 3.11 \
        --only-binary=:all: \
        "psycopg[binary]" "PyJWT[crypto]" python-dotenv typing_extensions
fi

echo "Building zip..."
mkdir -p zips
rm -rf staging_users
cp -r deps staging_users
cp -r shared staging_users/shared
cp lambdas/users/handler.py staging_users/lambda_function.py
(cd staging_users && zip -qr ../zips/lambda_users.zip .)
rm -rf staging_users

echo "Updating $FUNCTION..."
aws lambda update-function-code \
    --function-name "$FUNCTION" --zip-file "fileb://zips/lambda_users.zip" \
    --region "$REGION" --no-cli-pager \
    --query '{name:FunctionName,status:LastUpdateStatus}'
aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

echo ""
echo "Done. traveleria-users now returns the fields in the current handler.py."
