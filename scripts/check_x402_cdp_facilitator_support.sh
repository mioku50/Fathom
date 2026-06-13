#!/bin/bash
set -e

# Run the TypeScript diagnostic script using npx tsx
echo "Running CDP Facilitator Support Check..."
npx tsx scripts/check_x402_cdp_facilitator_support.ts
