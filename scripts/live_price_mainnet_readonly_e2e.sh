#!/bin/bash -x

# Ensure required environment variables are set or have defaults
if [ -z "$FATHOM_LIVE_URL" ]; then 
  FATHOM_LIVE_URL="http://localhost:8787"
  echo "FATHOM_LIVE_URL not set. Defaulting to $FATHOM_LIVE_URL"
fi

if [ -z "$ADMIN_AUTH_TOKEN" ]; then 
  echo "Error: ADMIN_AUTH_TOKEN is not set. Please set it to bypass x402 payment for testing."
  exit 1
fi

if [ -z "$PRICE_RPC_URL" ]; then 
  PRICE_RPC_URL="https://mainnet.base.org"
  echo "PRICE_RPC_URL not set. Defaulting to $PRICE_RPC_URL"
fi

if [ -z "$PIN_BLOCK" ]; then 
  PIN_BLOCK="latest"
  echo "PIN_BLOCK not set. Defaulting to $PIN_BLOCK"
fi

# We use AERO token on Base mainnet as a test token
TEST_TOKEN="0x940181a94A35A4569E4529A3CDfB74e38FD98631"

echo "Running Deterministic Base Mainnet Read-Only Price E2E Test"
echo "Target: $FATHOM_LIVE_URL"
echo "Token: $TEST_TOKEN"
echo "RPC: $PRICE_RPC_URL"
echo "Block: $PIN_BLOCK"

# 1. /v1/price should return 200 with expected price data using Admin Auth
echo "[1] Fetching price for $TEST_TOKEN"

# Clear cache first to ensure we hit the RPC
echo "[*] Clearing cache for pool"
curl -s -X POST -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" "$FATHOM_LIVE_URL/v1/cache/clear" > /dev/null

echo "[*] Fetching price"
PRICE_RES=$(curl -s -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" "$FATHOM_LIVE_URL/v1/price?token=$TEST_TOKEN")
PRICE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" "$FATHOM_LIVE_URL/v1/price?token=$TEST_TOKEN")

if [ "$PRICE_STATUS" != "200" ]; then
    echo "❌ Expected 200 for /v1/price, got $PRICE_STATUS"
    echo "Response: $PRICE_RES"
    exit 1
fi

if ! echo "$PRICE_RES" | grep -q "price_usd"; then
    echo "❌ /v1/price did not return expected orchestrator data"
    echo "Response: $PRICE_RES"
    exit 1
fi

PRICE_VALUE=$(echo "$PRICE_RES" | grep -o '"price_usd":[0-9.]*' | cut -d':' -f2)
echo "✅ /v1/price returned 200 OK. Price: $PRICE_VALUE"

echo "All tests passed successfully!"
