#!/bin/bash -x

if [ "$CONFIRM_MAINNET_X402_PAYMENT" != "YES" ]; then
    echo "⚠️  WARNING: This script performs REAL mainnet x402 payments using live USDC."
    echo "To proceed, you must set CONFIRM_MAINNET_X402_PAYMENT=YES in your environment."
    exit 1
fi

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

echo "Optional single-price smoke test"

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

echo "Smoke test passed successfully!"
