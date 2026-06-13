#!/bin/bash -x

if [ "$CONFIRM_MAINNET_X402_PAYMENT" != "YES" ]; then
    echo "⚠️  WARNING: This script performs REAL mainnet x402 payments using live USDC."
    echo "To proceed, you must set CONFIRM_MAINNET_X402_PAYMENT=YES in your environment."
    exit 1
fi

export FATHOM_LIVE_URL="https://fathom-api.mioku-fathom.workers.dev"
export X402_NETWORK="base"
export X402_PRICE_USDC="0.01"
export FATHOM_X402_RECIPIENT="0x940181a94A35A4569E4529A3CDfB74e38FD98631"
export FATHOM_X402_FACILITATOR_URL="https://api.fathom.network/facilitator"
export FATHOM_TEST_TOKEN="0x940181a94A35A4569E4529A3CDfB74e38FD98631" # AERO
export PRICE_CHAIN_ID="8453"

MISSING_VARS=()
if [ -z "$BASE_RPC_URL" ]; then MISSING_VARS+=("BASE_RPC_URL"); fi
if [ -z "$FATHOM_TEST_WALLET_PRIVATE_KEY" ]; then MISSING_VARS+=("FATHOM_TEST_WALLET_PRIVATE_KEY"); fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "Error: Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

export NODE_OPTIONS=--dns-result-order=ipv4first

echo "Running Live E2E Tests against Base MAINNET x402 Payment Gate"

# Stage 1: Protected endpoints without payment/auth must return 402
echo "[1] Checking protected endpoints without payment (Stage 1)"

# /v1/metadata
META_STATUS=$(curl -s -H "Connection: close" -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/metadata?token=$FATHOM_TEST_TOKEN")
if [ "$META_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/metadata without payment, got $META_STATUS"
    exit 1
fi
echo "✅ /v1/metadata without payment returned 402 OK"

# /v1/price
PRICE_STATUS=$(curl -s -H "Connection: close" -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/price?token=$FATHOM_TEST_TOKEN")
if [ "$PRICE_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/price without payment, got $PRICE_STATUS"
    exit 1
fi
echo "✅ /v1/price without payment returned 402 OK"

# /v1/prices
PRICES_STATUS=$(curl -s -H "Connection: close" -o /dev/null -w "%{http_code}" "$FATHOM_LIVE_URL/v1/prices?tokens=$FATHOM_TEST_TOKEN")
if [ "$PRICES_STATUS" != "402" ]; then
    echo "❌ Expected 402 for /v1/prices without payment, got $PRICES_STATUS"
    exit 1
fi
echo "✅ /v1/prices without payment returned 402 OK"

# Stage 2: Protected endpoints with payment/auth
echo "Sleeping 2 seconds to let dev server connections clear..."
sleep 2

echo "[2] Real MAINNET x402 payment validation (Stage 2)"

# Check /v1/metadata
node scripts/live_e2e_x402_helper.js metadata > .metadata_res 2> .metadata_err
if [ $? -ne 0 ]; then
    echo "❌ /v1/metadata failed:"
    cat .metadata_err
    exit 1
fi
META_RES=$(cat .metadata_res)
if ! echo "$META_RES" | grep -q "address"; then
    echo "❌ /v1/metadata did not return expected data: $META_RES"
    exit 1
fi
echo "✅ /v1/metadata with MAINNET payment OK"

# Check /v1/price
node scripts/live_e2e_x402_helper.js price > .price_res 2> .price_err
if [ $? -ne 0 ]; then
    echo "❌ /v1/price failed:"
    cat .price_err
    exit 1
else
    PRICE_RES=$(cat .price_res)
    if ! echo "$PRICE_RES" | grep -q "price_usd"; then
        echo "❌ /v1/price did not return expected orchestrator data"
        exit 1
    fi
    echo "✅ /v1/price with MAINNET payment OK, received price data."
fi

echo "All tests passed successfully!"
