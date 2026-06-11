# Live Base Sepolia E2E Testing

This document explains how to set up the environment and run the live E2E test script (`scripts/live_base_sepolia_e2e.sh`) against the live Fathom API on the Base Sepolia network.

## Setup `.env.live`

You must create a `.env.live` file in the repository root containing your actual credentials. **Never commit this file or expose your secrets.**

Example `.env.live` structure:

```env
FATHOM_LIVE_URL="https://fathom-api.mioku-fathom.workers.dev"
X402_NETWORK="base-sepolia"
BASE_RPC_URL="https://sepolia.base.org"
FATHOM_TEST_TOKEN="0xYourTestTokenAddress"
FATHOM_TEST_POOL="0xYourTestPoolAddress" # Optional
FATHOM_X402_RECIPIENT="0xYourX402RecipientAddress"
FATHOM_X402_FACILITATOR_URL="https://your-facilitator-url"
# FATHOM_TEST_WALLET_PRIVATE_KEY="your-private-key-here" # Optional for real payment signing
```

## Running the E2E Script

1. Open your terminal in the repository root.
2. Export your live environment variables:

   ```bash
   export $(grep -v '^#' .env.live | xargs)
   ```

3. Run the E2E bash script:

   ```bash
   ./scripts/live_base_sepolia_e2e.sh
   ```

If any required variables are missing, the script will abort and explicitly tell you which variables must be set. The script tests public endpoints (`/v1/health`, `/v1/cache/metrics`) and verifies that x402-protected endpoints properly return `402 Payment Required` when queried without payment headers. If `FATHOM_TEST_WALLET_PRIVATE_KEY` is provided, the script supports running the extended x402 on-chain validations natively against Base Sepolia.