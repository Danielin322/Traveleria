#!/bin/bash
# deploy_cloudshell.sh
# Run in AWS CloudShell after uploading and unzipping source.zip.
# Usage: bash deploy_cloudshell.sh
#
# Before running, create a .env file in this directory with:
#   DATABASE_URL=postgresql://postgres:PASSWORD@YOUR-RDS-HOST:5432/postgres
#   COGNITO_REGION=us-east-1
#   COGNITO_USER_POOL_ID=your-pool-id
#   COGNITO_APP_CLIENT_ID=your-client-id
#   OPENAI_API_KEY=your-openai-api-key
#   GOOGLE_PLACES_API_KEY=your-google-places-api-key   (optional — enables map pins for chat-added items)
#   WALLET_BUCKET=your-s3-bucket-name   (optional — defaults to
#                                        traveleria-wallet-<account-id>;
#                                        the bucket itself must already exist,
#                                        this script does not create it)
# See .env.example for a template.

set -euo pipefail

# ── Load secrets from .env ────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in your values."
  exit 1
fi
set -o allexport
source .env
set +o allexport

: "${DATABASE_URL:?DATABASE_URL must be set in .env}"
: "${COGNITO_USER_POOL_ID:?COGNITO_USER_POOL_ID must be set in .env}"
: "${COGNITO_APP_CLIENT_ID:?COGNITO_APP_CLIENT_ID must be set in .env}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY must be set in .env}"
# ─────────────────────────────────────────────────────────────────────────

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/LabRole"

COGNITO_REGION="${COGNITO_REGION:-us-east-1}"
GOOGLE_PLACES_API_KEY="${GOOGLE_PLACES_API_KEY:-}"
WALLET_BUCKET="${WALLET_BUCKET:-traveleria-wallet-${ACCOUNT_ID}}"

if ! aws s3api head-bucket --bucket "$WALLET_BUCKET" --region "$REGION" 2>/dev/null; then
    echo "WARNING: S3 bucket '${WALLET_BUCKET}' not found or not readable."
    echo "         Wallet uploads and the profile photo will fail until it exists:"
    echo "           aws s3 mb s3://${WALLET_BUCKET} --region ${REGION}"
    echo ""
fi

ENV_JSON="{\"Variables\":{\"DATABASE_URL\":\"${DATABASE_URL}\",\"COGNITO_REGION\":\"${COGNITO_REGION}\",\"COGNITO_USER_POOL_ID\":\"${COGNITO_USER_POOL_ID}\",\"COGNITO_APP_CLIENT_ID\":\"${COGNITO_APP_CLIENT_ID}\",\"OPENAI_API_KEY\":\"${OPENAI_API_KEY}\",\"GOOGLE_PLACES_API_KEY\":\"${GOOGLE_PLACES_API_KEY}\",\"WALLET_BUCKET\":\"${WALLET_BUCKET}\"}}"

LAMBDAS=(
    "health"
    "trips"
    "itinerary"
    "users"
    "chat"
    "wallet"
    "social"
)

# ── Step 0: Delete all existing traveleria Lambdas and API Gateway ────────
echo "=== Step 0: Deleting existing traveleria resources ==="

ALL_OLD_LAMBDAS=(
    "traveleria-health"
    "traveleria-trips-list"
    "traveleria-trips-create"
    "traveleria-itinerary-list"
    "traveleria-itinerary-create"
    "traveleria-itinerary-update"
    "traveleria-itinerary-delete"
    "traveleria-users-get"
    "traveleria-users-update"
    "traveleria-chat"
    "traveleria-trips"
    "traveleria-itinerary"
    "traveleria-users"
    "traveleria-wallet"
    "traveleria-social"
)

for FNAME in "${ALL_OLD_LAMBDAS[@]}"; do
    if aws lambda get-function --function-name "$FNAME" --region "$REGION" &>/dev/null; then
        echo "  Deleting Lambda: $FNAME"
        aws lambda delete-function --function-name "$FNAME" --region "$REGION"
    fi
done

EXISTING=$(aws apigateway get-rest-apis --region "$REGION" \
    --query "items[?name=='traveleria-api'].id" --output text)
if [ -n "$EXISTING" ]; then
    echo "  Deleting API Gateway: $EXISTING"
    aws apigateway delete-rest-api --rest-api-id "$EXISTING" --region "$REGION"
    echo "  Waiting 30s for API Gateway deletion..."
    sleep 30
fi

echo "  All cleared."
echo ""

# ── Step 1: Install pip dependencies once ─────────────────────────────────
echo "=== Step 1: Installing dependencies ==="
rm -rf deps
# --python-version 3.11 makes pip resolve conditional deps for Python 3.11
# (e.g. typing_extensions; python_version < '3.12' is included correctly)
# --platform + --only-binary ensures manylinux binaries compatible with Lambda
pip install --quiet --target ./deps \
    --platform manylinux2014_x86_64 \
    --python-version 3.11 \
    --only-binary=:all: \
    "psycopg[binary]" "PyJWT[crypto]" python-dotenv typing_extensions openai httpx

# ── Step 2: Build one zip per Lambda ──────────────────────────────────────
echo ""
echo "=== Step 2: Building Lambda zips ==="
mkdir -p zips

for NAME in "${LAMBDAS[@]}"; do
    echo "  → lambda_${NAME}.zip"
    STAGING="staging_${NAME}"
    rm -rf "$STAGING"
    cp -r deps "$STAGING"
    cp -r shared "$STAGING/shared"
    cp "lambdas/${NAME}/handler.py" "$STAGING/lambda_function.py"
    cd "$STAGING" && zip -qr "../zips/lambda_${NAME}.zip" . && cd ..
    rm -rf "$STAGING"
done

# ── Step 3: Deploy Lambda functions ───────────────────────────────────────
echo ""
echo "=== Step 3: Deploying Lambda functions ==="

deploy_lambda() {
    local FNAME=$1   # AWS function name  e.g. traveleria-trips
    local ZIP=$2     # zip filename       e.g. lambda_trips.zip
    echo "  → $FNAME"
    if aws lambda get-function --function-name "$FNAME" --region "$REGION" &>/dev/null; then
        aws lambda update-function-code \
            --function-name "$FNAME" --zip-file "fileb://zips/${ZIP}" \
            --region "$REGION" > /dev/null
        aws lambda wait function-updated --function-name "$FNAME" --region "$REGION"
        aws lambda update-function-configuration \
            --function-name "$FNAME" --timeout 30 \
            --environment "$ENV_JSON" --region "$REGION" > /dev/null
    else
        aws lambda create-function \
            --function-name "$FNAME" \
            --runtime python3.11 \
            --role "$ROLE_ARN" \
            --handler lambda_function.lambda_handler \
            --zip-file "fileb://zips/${ZIP}" \
            --timeout 30 \
            --environment "$ENV_JSON" \
            --region "$REGION" > /dev/null
    fi
}

deploy_lambda "traveleria-health"     "lambda_health.zip"
deploy_lambda "traveleria-trips"      "lambda_trips.zip"
deploy_lambda "traveleria-itinerary"  "lambda_itinerary.zip"
deploy_lambda "traveleria-users"      "lambda_users.zip"
deploy_lambda "traveleria-chat"       "lambda_chat.zip"
deploy_lambda "traveleria-wallet"     "lambda_wallet.zip"
deploy_lambda "traveleria-social"     "lambda_social.zip"

# ── Step 4: Create API Gateway ─────────────────────────────────────────────
echo ""
echo "=== Step 4: Creating API Gateway ==="

API_ID=$(aws apigateway create-rest-api \
    --name "traveleria-api" --region "$REGION" \
    --query 'id' --output text)
echo "  API ID: $API_ID"

ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" --region "$REGION" \
    --query 'items[0].id' --output text)

make_resource() {
    aws apigateway create-resource \
        --rest-api-id "$API_ID" --parent-id "$1" --path-part "$2" \
        --region "$REGION" --query 'id' --output text
}

add_method() {
    local RES_ID=$1 METHOD=$2 FNAME=$3
    local ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FNAME}"
    local URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${ARN}/invocations"

    aws apigateway put-method \
        --rest-api-id "$API_ID" --resource-id "$RES_ID" \
        --http-method "$METHOD" --authorization-type NONE \
        --region "$REGION" > /dev/null

    aws apigateway put-integration \
        --rest-api-id "$API_ID" --resource-id "$RES_ID" \
        --http-method "$METHOD" --type AWS_PROXY \
        --integration-http-method POST --uri "$URI" \
        --region "$REGION" > /dev/null

    aws lambda add-permission \
        --function-name "$FNAME" \
        --statement-id "allow-apigw-$(echo $METHOD$RES_ID | tr -d '{}/')" \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" \
        --region "$REGION" > /dev/null 2>&1 || true
}

echo "  Building resource tree..."
TRIPS_ID=$(make_resource "$ROOT_ID"  "trips")
TRIP_ID=$(make_resource  "$TRIPS_ID" "{trip_id}")
ITIN_ID=$(make_resource  "$TRIP_ID"  "itinerary")
EVENT_ID=$(make_resource "$ITIN_ID"  "{event_id}")
COLLABS_ID=$(make_resource "$TRIP_ID"    "collaborators")
COLLAB_ID=$(make_resource  "$COLLABS_ID" "{collaborator_id}")
OWNER_ID=$(make_resource   "$TRIP_ID"    "owner")
INVITES_ID=$(make_resource "$ROOT_ID"    "invitations")
INVITE_ID=$(make_resource  "$INVITES_ID" "{invitation_id}")
USERS_ID=$(make_resource "$ROOT_ID"  "users")
ME_ID=$(make_resource    "$USERS_ID" "me")
CHAT_ID=$(make_resource  "$ROOT_ID"  "chat")
WALLET_ID=$(make_resource "$ROOT_ID"   "wallet")
DOC_ID=$(make_resource    "$WALLET_ID" "{document_id}")
SOCIAL_ID=$(make_resource "$ROOT_ID"   "social")
POSTS_ID=$(make_resource  "$SOCIAL_ID" "posts")
POST_ID=$(make_resource   "$POSTS_ID"  "{post_id}")
LIKE_ID=$(make_resource   "$POST_ID"   "like")
POST_COMMENTS_ID=$(make_resource "$POST_ID"   "comments")
COMMENTS_ID=$(make_resource      "$SOCIAL_ID" "comments")
COMMENT_ID=$(make_resource       "$COMMENTS_ID" "{comment_id}")
PEOPLE_ID=$(make_resource        "$SOCIAL_ID" "people")
SOCIAL_USERS_ID=$(make_resource  "$SOCIAL_ID" "users")
SOCIAL_USER_ID=$(make_resource   "$SOCIAL_USERS_ID" "{user_id}")
FOLLOW_ID=$(make_resource        "$SOCIAL_USER_ID" "follow")
USER_POSTS_ID=$(make_resource    "$SOCIAL_USER_ID" "posts")
SHARED_TRIPS_ID=$(make_resource  "$SOCIAL_ID" "shared-trips")
SHARED_TRIP_ID=$(make_resource   "$SHARED_TRIPS_ID" "{trip_id}")
SHARED_TRIP_COPY_ID=$(make_resource "$SHARED_TRIP_ID" "copy")

echo "  Wiring routes → Lambdas..."
add_method "$ROOT_ID"  "GET"    "traveleria-health"
add_method "$TRIPS_ID" "GET"    "traveleria-trips"
add_method "$TRIPS_ID" "POST"   "traveleria-trips"
add_method "$TRIP_ID"  "PUT"    "traveleria-trips"
add_method "$TRIP_ID"  "DELETE" "traveleria-trips"
add_method "$ITIN_ID"  "GET"    "traveleria-itinerary"
add_method "$ITIN_ID"  "POST"   "traveleria-itinerary"
add_method "$EVENT_ID" "PUT"    "traveleria-itinerary"
add_method "$EVENT_ID" "DELETE" "traveleria-itinerary"
add_method "$COLLABS_ID" "GET"    "traveleria-trips"
add_method "$COLLABS_ID" "POST"   "traveleria-trips"
add_method "$COLLAB_ID"  "DELETE" "traveleria-trips"
add_method "$OWNER_ID"   "PUT"    "traveleria-trips"
add_method "$INVITES_ID" "GET"    "traveleria-trips"
add_method "$INVITE_ID"  "PUT"    "traveleria-trips"
add_method "$ME_ID"    "GET"    "traveleria-users"
add_method "$ME_ID"    "PATCH"  "traveleria-users"
add_method "$CHAT_ID"  "GET"    "traveleria-chat"
add_method "$CHAT_ID"  "POST"   "traveleria-chat"
add_method "$WALLET_ID" "GET"    "traveleria-wallet"
add_method "$WALLET_ID" "POST"   "traveleria-wallet"
add_method "$DOC_ID"    "PUT"    "traveleria-wallet"
add_method "$DOC_ID"    "DELETE" "traveleria-wallet"
add_method "$POSTS_ID"          "GET"    "traveleria-social"
add_method "$POSTS_ID"          "POST"   "traveleria-social"
add_method "$POST_ID"           "PUT"    "traveleria-social"
add_method "$POST_ID"           "DELETE" "traveleria-social"
add_method "$LIKE_ID"           "POST"   "traveleria-social"
add_method "$LIKE_ID"           "DELETE" "traveleria-social"
add_method "$POST_COMMENTS_ID"  "POST"   "traveleria-social"
add_method "$COMMENT_ID"        "DELETE" "traveleria-social"
add_method "$PEOPLE_ID"         "GET"    "traveleria-social"
add_method "$SOCIAL_USER_ID"    "GET"    "traveleria-social"
add_method "$FOLLOW_ID"         "POST"   "traveleria-social"
add_method "$FOLLOW_ID"         "DELETE" "traveleria-social"
add_method "$USER_POSTS_ID"     "GET"    "traveleria-social"
add_method "$SHARED_TRIP_ID"       "GET"  "traveleria-social"
add_method "$SHARED_TRIP_COPY_ID"  "POST" "traveleria-social"

echo "  Deploying to stage 'prod'..."
aws apigateway create-deployment \
    --rest-api-id "$API_ID" --stage-name "prod" \
    --region "$REGION" > /dev/null

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod"

echo ""
echo "======================================================"
echo "  Done! 7 Lambdas + API Gateway deployed."
echo "======================================================"
echo ""
echo "  API URL:  ${API_URL}"
echo ""
echo "  -> Set EXPO_PUBLIC_API_URL=${API_URL}"
echo "     in traveleria/.env then rebuild the app."
echo ""
