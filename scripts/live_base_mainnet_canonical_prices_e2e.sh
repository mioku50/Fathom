#!/bin/bash
set -e

# Wait for local dev server to be ready
echo "Waiting for local API..."
sleep 2

echo ""
echo "=== Testing Canonical Prices ==="
echo ""

# We will test AERO, USDC, WETH
RES=$(curl --noproxy "*" -s -H "Authorization: Bearer test" "http://127.0.0.1:8787/v1/prices?tokens=0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,0x4200000000000000000000000000000000000006")

echo $RES | jq .

# Extract prices
AERO_PRICE=$(echo $RES | jq -r '.results[] | select(.token | ascii_downcase == "0x940181a94a35a4569e4529a3cdfb74e38fd98631") | .price_usd')
USDC_PRICE=$(echo $RES | jq -r '.results[] | select(.token | ascii_downcase == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") | .price_usd')
WETH_PRICE=$(echo $RES | jq -r '.results[] | select(.token | ascii_downcase == "0x4200000000000000000000000000000000000006") | .price_usd')

echo ""
echo "AERO Price: $AERO_PRICE"
echo "USDC Price: $USDC_PRICE"
echo "WETH Price: $WETH_PRICE"

if [[ "$USDC_PRICE" != "1" && "$USDC_PRICE" != "1.0" && "$USDC_PRICE" != "1.00" ]]; then
  echo "❌ USDC price is wrong"
  exit 1
fi

if (( $(echo "$WETH_PRICE < 1000" | bc -l) )); then
  echo "❌ WETH price is suspiciously low"
  exit 1
fi

if (( $(echo "$AERO_PRICE < 0.01" | bc -l) )); then
  echo "❌ AERO price is suspiciously low"
  exit 1
fi

echo "✅ All canonical prices look sane."
exit 0
