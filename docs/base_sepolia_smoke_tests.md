# Base Sepolia Smoke Tests

## Overview
This document describes how to safely test Fathom endpoints against the live Base Sepolia environment without requiring admin secrets or deploying code.

### Deployment Context
- **Live Worker URL**: `https://fathom-api.mioku-fathom.workers.dev`
- **Worker Name**: `fathom-api`
- **Network**: `base-sepolia`
- **Chain ID**: `84532`
- **KV Binding**: `FATHOM_KV`
- **Public X402 Recipient**: `0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909`

## Running the Tests
A safe smoke test script is provided in `scripts/live_smoke_test.sh`.

### Usage
```bash
# Test the default live endpoint
./scripts/live_smoke_test.sh

# Or test a specific endpoint by overriding the environment variable
FATHOM_LIVE_URL="http://localhost:8787" ./scripts/live_smoke_test.sh
```

### Endpoints Verified
- `/v1/health` - Should return HTTP 200 with status "ok"
- `/v1/cache/metrics` - Should return HTTP 200 with JSON cache hit/miss statistics.

## Security Considerations
- **No Secrets**: This manual smoke test strictly uses public read-only endpoints. Do not pass or log admin credentials, RPC secrets, or private keys.
- **No Deployments**: This process tests what is *already* deployed. Do not run wrangler commands from within the automated loop context unless specifically executing a deployment task.
