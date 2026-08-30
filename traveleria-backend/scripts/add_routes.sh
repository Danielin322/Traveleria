#!/bin/bash
# add_routes.sh — add missing routes to the EXISTING traveleria API.
#
# Run in AWS CloudShell:  bash scripts/add_routes.sh
#
# This script is ADDITIVE ONLY. It contains no delete-* call of any kind, and
# it never creates a REST API. It looks the existing API up by name, adds only
# the resources and methods that are missing, and redeploys the same 'prod'
# stage.
#
#   >>> The invoke URL does not change. <<<
#
# That is the whole reason this file exists. deploy_cloudshell.sh calls
# delete-rest-api and then create-rest-api, which mints a NEW api id and a new
# invoke URL, breaking EXPO_PUBLIC_API_URL in every installed build. Never run
# that script to add a route. Run this one.

set -euo pipefail

REGION="us-east-1"
API_NAME="traveleria-api"
STAGE="prod"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

API_ID=$(aws apigateway get-rest-apis --region "$REGION" \
    --query "items[?name=='${API_NAME}'].id | [0]" --output text)

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    echo "ERROR: no REST API named '${API_NAME}' in ${REGION} (account ${ACCOUNT_ID})."
    echo "This script only modifies an existing API; it will not create one."
    exit 1
fi

echo "API:     $API_ID  (account $ACCOUNT_ID)"
echo "URL:     https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}"
echo ""

# Resource id for a full path, or empty when it does not exist yet.
resource_id() {
    aws apigateway get-resources --rest-api-id "$API_ID" --region "$REGION" \
        --limit 500 --query "items[?path=='$1'].id | [0]" --output text
}

# Create a child resource only when missing; echo its id either way.
ensure_resource() {
    local PARENT_PATH=$1 PART=$2
    local FULL="${PARENT_PATH%/}/${PART}"
    local EXISTING
    EXISTING=$(resource_id "$FULL")
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
        echo "$EXISTING"
        return
    fi
    local PARENT_ID
    PARENT_ID=$(resource_id "$PARENT_PATH")
    aws apigateway create-resource --rest-api-id "$API_ID" \
        --parent-id "$PARENT_ID" --path-part "$PART" \
        --region "$REGION" --query 'id' --output text
}

# Wire one method to one Lambda, skipping it if already present.
ensure_method() {
    local RES_ID=$1 METHOD=$2 FNAME=$3 LABEL=$4
    if aws apigateway get-method --rest-api-id "$API_ID" --resource-id "$RES_ID" \
        --http-method "$METHOD" --region "$REGION" >/dev/null 2>&1; then
        echo "  = $METHOD $LABEL already wired"
        return
    fi
    echo "  + $METHOD $LABEL -> $FNAME"

    local ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FNAME}"
    aws apigateway put-method --rest-api-id "$API_ID" --resource-id "$RES_ID" \
        --http-method "$METHOD" --authorization-type NONE --region "$REGION" >/dev/null
    aws apigateway put-integration --rest-api-id "$API_ID" --resource-id "$RES_ID" \
        --http-method "$METHOD" --type AWS_PROXY --integration-http-method POST \
        --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${ARN}/invocations" \
        --region "$REGION" >/dev/null
    aws lambda add-permission --function-name "$FNAME" \
        --statement-id "allow-apigw-$(echo "$METHOD$RES_ID" | tr -d '{}/')" \
        --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" \
        --region "$REGION" >/dev/null 2>&1 || true
}

echo "Editing and deleting trips:"
TRIP_ID=$(ensure_resource "/trips" "{trip_id}")
ensure_method "$TRIP_ID" "PUT"    "traveleria-trips" "/trips/{trip_id}"
ensure_method "$TRIP_ID" "DELETE" "traveleria-trips" "/trips/{trip_id}"

echo ""
echo "Redeploying stage '${STAGE}'..."
aws apigateway create-deployment --rest-api-id "$API_ID" \
    --stage-name "$STAGE" --region "$REGION" >/dev/null

echo ""
echo "Done. URL is unchanged:"
echo "  https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}"
