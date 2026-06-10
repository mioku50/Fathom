# Base Sepolia X402 Live Validation Plan

This document outlines the manual steps to validate the x402 payment flow against the live Fathom API on the Base Sepolia network.

**Important Security Notice:** This procedure must be executed manually by an engineer. Do not script this flow using live private keys, Cloudflare tokens, RPC secrets, or admin tokens. Do not expose or commit these credentials in any system or repository.

## Prerequisites

1.  **A test wallet:** Set up a wallet connected to the Base Sepolia network (`Chain ID: 84532`).
2.  **Test Funds:** The wallet must hold Base Sepolia ETH (for gas) and Mock USDC (to make the x402 payment).
3.  **Live Endpoint URL:** `https://fathom-api.mioku-fathom.workers.dev`

## Validation Steps

The x402 protocol consists of an initial unauthenticated request, a 402 challenge response, an on-chain payment, proof generation, and a final authenticated request.

### 1. Trigger the 402 Challenge

Send an initial request to a protected endpoint (e.g., `/v1/price`) without payment headers. This will return the payment parameters required to construct the transaction.

```bash
curl -i "https://fathom-api.mioku-fathom.workers.dev/v1/price?token=0xSomeTokenAddress"
```

**Expected Response:**
*   HTTP Status Code: `402 Payment Required`
*   Headers: `Www-Authenticate: x402`
*   Body: A JSON object containing `payment_address`, `payment_amount` (in USDC), and `payment_chain_id`.

### 2. Execute On-Chain Payment

Using the test wallet from the prerequisites, initiate an ERC-20 transfer of the `payment_amount` to the `payment_address` specified in the 402 response.

*   **Asset:** USDC
*   **Network:** Base Sepolia
*   **To:** `<payment_address>`
*   **Amount:** `<payment_amount>`

Wait for the transaction to be confirmed and copy the transaction hash.

### 3. Generate the Payment Proof

The Fathom API expects the proof to be provided in the `X-PAYMENT` header. The structure typically encodes the transaction hash and potentially other signature details as defined by the protocol implementation.

For the purposes of this manual validation, construct the required x402 header payload using the confirmed transaction hash.

*Format:* `x402 tx=<transaction_hash>` (or according to the specific x402 header formatting used by Fathom).

### 4. Resubmit the Request with Payment

Repeat the original request, this time including the `X-PAYMENT` header.

```bash
curl -i -H "X-PAYMENT: x402 tx=<transaction_hash>" "https://fathom-api.mioku-fathom.workers.dev/v1/price?token=0xSomeTokenAddress"
```

**Expected Response:**
*   HTTP Status Code: `200 OK`
*   Body: The JSON payload containing the requested token's price, liquidity, and confidence data.
