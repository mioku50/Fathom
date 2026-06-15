#!/usr/bin/env bash
set -e

# Load environment variables
if [ -f .env ]; then
  source .env
fi

WORKER_URL="https://fathom-api.mioku-fathom.workers.dev"
# AERO and WETH
TOKENS="0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x4200000000000000000000000000000000000006"

echo "========================================"
echo " FATHOM LIVE BATCH PRICES E2E TEST"
echo " Target: $WORKER_URL"
echo " Tokens: $TOKENS"
echo "========================================"

# Test 1: Unpaid request should return 402
echo "1. Testing unpaid batch request..."
UNPAID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/v1/prices?tokens=$TOKENS")

if [ "$UNPAID_STATUS" -ne 402 ]; then
  echo "❌ FAILED: Expected 402 Payment Required, got $UNPAID_STATUS"
  exit 1
fi
echo "✅ Unpaid request returned 402 as expected."

# If we don't have CDP keys, we can't test the paid flow locally
if [ -z "$FATHOM_TEST_WALLET_PRIVATE_KEY" ]; then
  echo "⚠️ Skipping paid flow test: FATHOM_TEST_WALLET_PRIVATE_KEY not set."
  exit 0
fi

echo "2. Testing paid batch request..."

# Check /v1/prices
node scripts/live_e2e_x402_helper.js prices > .prices_res 2> .prices_err
if [ $? -ne 0 ]; then
    echo "❌ /v1/prices failed:"
    cat .prices_err
    exit 1
fi

PRICES_RES=$(cat .prices_res)
echo "$PRICES_RES"

if ! echo "$PRICES_RES" | grep -q '"chain"'; then echo "❌ Missing chain" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"count"'; then echo "❌ Missing count" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"priced"'; then echo "❌ Missing priced" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"failed"'; then echo "❌ Missing failed" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"results"'; then echo "❌ Missing results" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"status":"ok"'; then echo "❌ Missing status: ok" && exit 1; fi
if ! echo "$PRICES_RES" | grep -q '"price_usd"'; then echo "❌ Missing price_usd" && exit 1; fi

echo "✅ Paid batch request successful!"

echo "E2E batch pricing script finished successfully."
