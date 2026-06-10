#!/bin/bash

# Default to the known live deployment URL, but allow overrides
LIVE_URL="${FATHOM_LIVE_URL:-https://fathom-api.mioku-fathom.workers.dev}"

echo "Starting Fathom smoke tests against: $LIVE_URL"
echo "------------------------------------------------------"

# 1. Health Check
echo "[1] Checking /v1/health ..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$LIVE_URL/v1/health")
if [ "$HEALTH_RESPONSE" -eq 200 ]; then
  echo "✅ /v1/health is OK (200)"
else
  echo "❌ /v1/health failed with status $HEALTH_RESPONSE"
fi

# 2. Cache Metrics Check
echo "[2] Checking /v1/cache/metrics ..."
METRICS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$LIVE_URL/v1/cache/metrics")
if [ "$METRICS_RESPONSE" -eq 200 ]; then
  echo "✅ /v1/cache/metrics is OK (200)"
else
  echo "❌ /v1/cache/metrics failed with status $METRICS_RESPONSE"
fi

echo "------------------------------------------------------"
echo "Smoke tests completed."
