#!/bin/bash

# Default to the known live deployment URL, but allow overrides
LIVE_URL="${FATHOM_LIVE_URL:-https://fathom-api.mioku-fathom.workers.dev}"

echo "Starting Fathom smoke tests against: $LIVE_URL"
echo "------------------------------------------------------"

# 1. Health Check
echo "[1] Checking /v1/health ..."
HEALTH_RESPONSE=$(curl -m 10 -s -o /dev/null -w "%{http_code}" "$LIVE_URL/v1/health")
if [ "$HEALTH_RESPONSE" -eq 200 ]; then
  echo "✅ /v1/health is OK (200)"
else
  echo "❌ /v1/health failed with status $HEALTH_RESPONSE"
fi

# 2. Cache Metrics Check
echo "[2] Checking /v1/cache/metrics ..."
METRICS_RESPONSE=$(curl -m 10 -s -o /dev/null -w "%{http_code}" "$LIVE_URL/v1/cache/metrics")
if [ "$METRICS_RESPONSE" -eq 200 ]; then
  echo "✅ /v1/cache/metrics is OK (200)"
else
  echo "❌ /v1/cache/metrics failed with status $METRICS_RESPONSE"
fi

# 3. x402-protected endpoint check
echo "[3] Checking x402-protected /v1/price ..."
if [ -n "$FATHOM_AUTH_HEADER" ] || [ -n "$FATHOM_X402_PAYMENT" ]; then
  echo "   Credentials found. Running x402 protected check..."
  # Use Auth Header if available, else fallback to X-PAYMENT
  if [ -n "$FATHOM_AUTH_HEADER" ]; then
    HEADER_ARG="-H \"Authorization: $FATHOM_AUTH_HEADER\""
  else
    HEADER_ARG="-H \"X-PAYMENT: $FATHOM_X402_PAYMENT\""
  fi

  PRICE_RESPONSE=$(eval curl -m 10 -s -o /dev/null -w \"%{http_code}\" $HEADER_ARG "$LIVE_URL/v1/price")
  if [ "$PRICE_RESPONSE" -eq 200 ]; then
    echo "✅ /v1/price is OK (200) with credentials"
  else
    echo "❌ /v1/price failed with status $PRICE_RESPONSE"
  fi
else
  echo "⏭️  Skipping admin/x402-protected checks (no local credentials provided)."
fi

echo "------------------------------------------------------"
echo "Smoke tests completed."
