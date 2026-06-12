#!/bin/bash

MISSING_VARS=()
if [ -z "$FATHOM_LIVE_URL" ]; then MISSING_VARS+=("FATHOM_LIVE_URL"); fi
if [ -z "$X402_NETWORK" ]; then MISSING_VARS+=("X402_NETWORK"); fi
if [ -z "$BASE_RPC_URL" ]; then MISSING_VARS+=("BASE_RPC_URL"); fi
if [ -z "$FATHOM_TEST_TOKEN" ]; then MISSING_VARS+=("FATHOM_TEST_TOKEN"); fi
if [ -z "$FATHOM_X402_RECIPIENT" ]; then MISSING_VARS+=("FATHOM_X402_RECIPIENT"); fi
if [ -z "$FATHOM_X402_FACILITATOR_URL" ]; then MISSING_VARS+=("FATHOM_X402_FACILITATOR_URL"); fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "Error: Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo "Please configure them in .env.live and source it before running."
    exit 1
fi

echo "Running Live E2E Tests against Base Sepolia"

# 1. /v1/health returns 200
echo "[1] Checking /v1/health"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/health")
if [ "$HEALTH_STATUS" != "200" ]; then
    echo "❌ /v1/health failed (status $HEALTH_STATUS)"
    exit 1
fi
echo "✅ /v1/health OK"

# 2. /v1/cache/metrics returns 200
echo "[2] Checking /v1/cache/metrics"
CACHE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/cache/metrics")
if [ "$CACHE_STATUS" != "200" ]; then
    echo "❌ /v1/cache/metrics failed (status $CACHE_STATUS)"
    exit 1
fi
echo "✅ /v1/cache/metrics OK"

# Stage 1: Protected endpoints without payment/auth must return 402
echo "[3] Checking protected endpoints without payment (Stage 1)"

# /v1/metadata
META_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/metadata?token=$FATHOM_TEST_TOKEN")
if [ "$META_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/metadata without payment, got $META_STATUS"
    exit 1
fi
echo "✅ /v1/metadata without payment returned 402 OK"

# /v1/price
PRICE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/price?token=$FATHOM_TEST_TOKEN")
if [ "$PRICE_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/price without payment, got $PRICE_STATUS"
    exit 1
fi
echo "✅ /v1/price without payment returned 402 OK"

# /v1/prices
PRICES_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/prices?tokens=$FATHOM_TEST_TOKEN")
if [ "$PRICES_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/prices without payment, got $PRICES_STATUS"
    exit 1
fi
echo "✅ /v1/prices without payment returned 402 OK"

# Stage 2: Protected endpoints with payment/auth
echo "[4] Real x402 payment validation (Stage 2)"
if [ -n "$FATHOM_TEST_WALLET_PRIVATE_KEY" ]; then
    echo "Real x402 payment validation is enabled."

    # Check /v1/metadata
    META_RES=$(node scripts/live_e2e_x402_helper.js metadata)
    if [ $? -ne 0 ]; then
        echo "❌ /v1/metadata failed: $META_RES"
        exit 1
    fi
    if ! echo "$META_RES" | grep -q "address"; then
        echo "❌ /v1/metadata did not return expected data"
        exit 1
    fi
    echo "✅ /v1/metadata with payment OK"

    # Check /v1/price
    PRICE_RES=$(node scripts/live_e2e_x402_helper.js price 2>&1)
    if [ $? -ne 0 ]; then
        if echo "$PRICE_RES" | grep -q "not_found"; then
            echo "✅ /v1/price reached orchestrator (payment verified), no pools found for test token"
        else
            echo "❌ /v1/price failed: $PRICE_RES"
            exit 1
        fi
    else
        if ! echo "$PRICE_RES" | grep -q "price_usd"; then
            echo "❌ /v1/price did not return expected orchestrator data"
            exit 1
        fi
        echo "✅ /v1/price with payment OK"
    fi

else
    echo "⏭️ Skipping real x402 payment validation (FATHOM_TEST_WALLET_PRIVATE_KEY not set)."
fi

echo "All tests passed successfully!"
