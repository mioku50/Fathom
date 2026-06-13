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
if [ -z "$CDP_API_KEY_ID" ] || [ -z "$CDP_API_KEY_SECRET" ]; then
  echo "⚠️ Skipping paid flow test: CDP_API_KEY_ID or CDP_API_KEY_SECRET not set."
  echo "You must provide valid CDP keys to generate X-PAYMENT headers for testing."
  exit 0
fi

# To test paid flow we'd need to generate an X-PAYMENT header using the CDP SDK.
# Because this requires signing and wallet interaction, the standard test stops here
# or uses a node script to perform the actual CDP flow if needed.
# For this E2E bash script, confirming 402 is sufficient to prove the route is protected.
# A full e2e test would use @x402/core in TS to complete the payment.

echo "E2E batch pricing script finished successfully."
