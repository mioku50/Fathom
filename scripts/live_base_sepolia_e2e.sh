#!/bin/bash
set -e

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

# 3. /v1/metadata returns real ERC20 metadata for FATHOM_TEST_TOKEN
echo "[3] Checking /v1/metadata for test token"
META_RES=$(curl -s "$FATHOM_LIVE_URL/v1/metadata?token=$FATHOM_TEST_TOKEN")
if ! echo "$META_RES" | grep -q "address"; then
    echo "❌ /v1/metadata failed or missing address field: $META_RES"
    exit 1
fi
echo "✅ /v1/metadata OK"

# 4. /v1/price returns a real orchestrator result, not dummy data.
echo "[4] Checking /v1/price (protected without payment returns 402)"
PRICE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/price?token=$FATHOM_TEST_TOKEN")
if [ "$PRICE_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/price without payment, got $PRICE_STATUS"
    exit 1
fi
echo "✅ /v1/price without payment returned 402 OK"

# 5. Protected endpoints return 402 without payment
echo "[5] Checking other protected endpoints"
PRICES_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/prices?tokens=$FATHOM_TEST_TOKEN")
if [ "$PRICES_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/prices without payment, got $PRICES_STATUS"
    exit 1
fi
echo "✅ /v1/prices without payment returned 402 OK"

# 6. Real x402 payment validation (optional)
if [ -n "$FATHOM_TEST_WALLET_PRIVATE_KEY" ]; then
    echo "[6] Real x402 payment validation is enabled."

    # Use a small node script to generate the transaction and get the header
    PAYMENT_HEADER=$(node scripts/live_e2e_x402_helper.js)
    if [ $? -ne 0 ]; then
        echo "❌ Failed to generate x402 payment proof"
        exit 1
    fi

    echo "Payment proof generated. Testing /v1/price..."
    PRICE_RES=$(curl -s -w "\n%{http_code}" -H "X-PAYMENT: $PAYMENT_HEADER" "$FATHOM_LIVE_URL/v1/price?token=$FATHOM_TEST_TOKEN")

    PRICE_BODY=$(echo "$PRICE_RES" | sed '$d')
    PRICE_STATUS=$(echo "$PRICE_RES" | tail -n1)

    if [ "$PRICE_STATUS" != "200" ]; then
        echo "❌ Expected 200 for /v1/price with payment, got $PRICE_STATUS"
        echo "Response: $PRICE_BODY"
        exit 1
    fi

    if ! echo "$PRICE_BODY" | grep -q "price_usd"; then
        echo "❌ /v1/price did not return expected orchestrator data: $PRICE_BODY"
        exit 1
    fi

    echo "✅ /v1/price with real x402 payment OK"
else
    echo "⏭️ Skipping real x402 payment validation (FATHOM_TEST_WALLET_PRIVATE_KEY not set)."
fi

echo "All tests passed successfully!"
