#!/bin/bash
# deploy_function.sh — update ONE traveleria Lambda's code, in place.
#
# Run in AWS CloudShell, from traveleria-backend:
#     bash scripts/deploy_function.sh trips
#     bash scripts/deploy_function.sh trips itinerary chat users
#
# Optionally merge an environment variable into the function while you are
# there (repeatable). The existing variables are read back and merged, never
# replaced:
#     bash scripts/deploy_function.sh trips --env WALLET_BUCKET=my-bucket
#
# Generalised from deploy_wallet.sh, which did this for one function only. It
# exists because there was no safe way to ship a code change to the other five:
# deploy_cloudshell.sh calls delete-rest-api and mints a NEW invoke URL, which
# breaks EXPO_PUBLIC_API_URL in every installed build.
#
#   >>> This script never touches API Gateway. The invoke URL cannot change. <<<
#
# It also only ever UPDATES. Creating a function, wiring its routes and setting
# its environment from scratch is deploy_cloudshell.sh's job, in a fresh lab.
#
# Two things it is careful about, both inherited from deploy_wallet.sh:
#
#   1. update-function-configuration --environment REPLACES the whole variable
#      map. Adding one key naively would wipe DATABASE_URL, the Cognito
#      settings and OPENAI_API_KEY. Every write below merges into the map that
#      is already there.
#   2. It never prints an environment block. Those values include the database
#      password and two API keys, and an aws command echoing them in full is
#      how they leaked once already.

set -euo pipefail

REGION="us-east-1"

VALID_FUNCTIONS=("health" "trips" "itinerary" "users" "chat" "wallet")

FUNCTIONS=()
ENV_PAIRS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --env)
            [ $# -ge 2 ] || { echo "ERROR: --env needs KEY=VALUE"; exit 1; }
            ENV_PAIRS+=("$2")
            shift 2
            ;;
        --env=*)
            ENV_PAIRS+=("${1#--env=}")
            shift
            ;;
        -*)
            echo "ERROR: unknown option '$1'"
            exit 1
            ;;
        *)
            FUNCTIONS+=("$1")
            shift
            ;;
    esac
done

if [ ${#FUNCTIONS[@]} -eq 0 ]; then
    echo "Usage: bash scripts/deploy_function.sh <name> [<name>...] [--env KEY=VALUE]"
    echo "Names: ${VALID_FUNCTIONS[*]}"
    exit 1
fi

for NAME in "${FUNCTIONS[@]}"; do
    FOUND=""
    for VALID in "${VALID_FUNCTIONS[@]}"; do
        [ "$NAME" = "$VALID" ] && FOUND="yes"
    done
    if [ -z "$FOUND" ]; then
        echo "ERROR: '$NAME' is not a traveleria Lambda. Expected one of: ${VALID_FUNCTIONS[*]}"
        exit 1
    fi
    if [ ! -f "lambdas/${NAME}/handler.py" ]; then
        echo "ERROR: lambdas/${NAME}/handler.py not found. Run this from traveleria-backend."
        exit 1
    fi
done

# ── Dependencies, built once and reused ───────────────────────────────────
# One deps/ for every function. openai and httpx are only needed by chat, but
# a shared directory is simpler than a per-function one and the extra weight
# costs nothing that matters. boto3 is deliberately absent: it is preinstalled
# in the Lambda runtime, so bundling our own copy would only add size and drift.
if [ ! -d deps ]; then
    echo "Installing dependencies (first run only)..."
    pip install --quiet --target ./deps \
        --platform manylinux2014_x86_64 --python-version 3.11 \
        --only-binary=:all: \
        "psycopg[binary]" "PyJWT[crypto]" python-dotenv typing_extensions openai httpx
    echo ""
fi

mkdir -p zips

for NAME in "${FUNCTIONS[@]}"; do
    FUNCTION="traveleria-${NAME}"
    echo "── ${FUNCTION} ─────────────────────────────────────────"

    if ! aws lambda get-function --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
        echo "  ! ${FUNCTION} does not exist in this account."
        echo "    This script only updates. Use deploy_cloudshell.sh to build a lab from scratch."
        exit 1
    fi

    STAGING="staging_${NAME}"
    rm -rf "$STAGING"
    cp -r deps "$STAGING"
    cp -r shared "$STAGING/shared"
    cp "lambdas/${NAME}/handler.py" "$STAGING/lambda_function.py"
    (cd "$STAGING" && zip -qr "../zips/lambda_${NAME}.zip" .)
    rm -rf "$STAGING"
    echo "  built zips/lambda_${NAME}.zip"

    aws lambda update-function-code \
        --function-name "$FUNCTION" --zip-file "fileb://zips/lambda_${NAME}.zip" \
        --region "$REGION" --no-cli-pager \
        --query '{name:FunctionName,status:LastUpdateStatus}'
    aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

    # update-function-code leaves environment variables alone, so this only
    # runs when there is something to add.
    if [ ${#ENV_PAIRS[@]} -gt 0 ]; then
        echo "  merging ${#ENV_PAIRS[@]} environment variable(s)..."
        # Piped from get- straight into put-; never echoed.
        MERGED=$(aws lambda get-function-configuration \
            --function-name "$FUNCTION" --region "$REGION" \
            --query 'Environment.Variables' --output json)
        MERGED=${MERGED:-\{\}}
        [ "$MERGED" = "null" ] && MERGED="{}"

        for PAIR in "${ENV_PAIRS[@]}"; do
            KEY="${PAIR%%=*}"
            VALUE="${PAIR#*=}"
            if [ "$KEY" = "$PAIR" ]; then
                echo "  ERROR: --env expects KEY=VALUE, got '$PAIR'"
                exit 1
            fi
            MERGED=$(echo "$MERGED" | jq -c --arg k "$KEY" --arg v "$VALUE" '. + {($k): $v}')
        done

        aws lambda update-function-configuration \
            --function-name "$FUNCTION" \
            --environment "{\"Variables\":${MERGED}}" \
            --region "$REGION" --no-cli-pager \
            --query '{name:FunctionName,status:LastUpdateStatus}'
        aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"
    fi

    echo ""
done

echo "Done. The API invoke URL is unchanged."
echo "If you added or removed routes, run:  bash scripts/add_routes.sh"
