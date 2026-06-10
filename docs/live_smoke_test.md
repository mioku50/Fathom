# Live Base Sepolia Smoke Tests

## Overview
This document outlines how to safely test the Fathom endpoints against the live Base Sepolia deployment.

### Live Environment
- **URL**: `https://fathom-api.mioku-fathom.workers.dev`
- **Network**: `base-sepolia`
- **Chain ID**: `84532`

## Running the Smoke Tests
We have a safe smoke-test script located at `scripts/live_smoke_test.sh`. This script only queries safe public endpoints such as `/v1/health` and `/v1/cache/metrics` and **does not require or hardcode any secrets.**

### Usage
Run the script from your terminal:

```bash
./scripts/live_smoke_test.sh
```

If you wish to test against a different endpoint (for example, local development), you can override the URL:

```bash
FATHOM_LIVE_URL="http://localhost:8787" ./scripts/live_smoke_test.sh
```

## Security Notice
- No administrative secrets are hardcoded in the test script.
- The smoke test queries read-only public endpoints unless authorization is optionally provided via environment variables (`FATHOM_AUTH_HEADER` or `FATHOM_X402_PAYMENT`).
