#!/bin/bash -e

# Ensure required environment variables are set or have defaults
if [ -z "$FATHOM_LIVE_URL" ]; then 
  FATHOM_LIVE_URL="http://localhost:8787"
  echo "FATHOM_LIVE_URL not set. Defaulting to $FATHOM_LIVE_URL"
fi

if [ -z "$ADMIN_AUTH_TOKEN" ]; then 
  echo "Error: ADMIN_AUTH_TOKEN is not set. Please set it to bypass x402 payment for testing."
  exit 1
fi

echo "Running Fallback Smoke Test"
echo "Target: $FATHOM_LIVE_URL"

if [[ "$FATHOM_LIVE_URL" != *"localhost"* ]] && [[ "$FATHOM_LIVE_URL" != *"127.0.0.1"* ]]; then
  echo "⚠️ WARNING: You are testing against a deployed remote Cloudflare Worker."
  echo "⚠️ Ensure your remote worker has a BAD primary PRICE_RPC_URL and a GOOD PRICE_RPC_FALLBACK_URLS configured."
else
  echo "ℹ️ Local test:"
  echo "ℹ️ Start your worker locally with:"
  echo "ℹ️ PRICE_RPC_URL=https://bad-rpc.example.com PRICE_RPC_FALLBACK_URLS=https://mainnet.base.org npm run dev"
fi

TEST_TOKEN="0x940181a94A35A4569E4529A3CDfB74e38FD98631"
echo "Token: $TEST_TOKEN"

echo "[1] Fetching price for $TEST_TOKEN"
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
echo "✅ /v1/price returned 200 OK. Fallback works! Price: $PRICE_VALUE"

echo "All tests passed successfully!"
