---
name: fathom
title: Fathom Pre-Trade Exit Assessment Plugin
type: plugin-spec
version: 1.0.0
host_allowlist:
  - fathom-api.mioku-fathom.workers.dev
max_payment_usdc: 0.001
---

# Fathom Plugin Specification for Base MCP

This specification defines a thin orchestration plugin for Base MCP to invoke Fathom's exit liquidity and pre-trade assessment oracle.

## Architecture

This is a plugin candidate specification that leverages Base MCP's existing runtime and x402 payment capability. It is NOT a separate MCP server.

## Invocation Rules

- **Explicit Selection Only**: Only trigger when the user explicitly requests Fathom assessment, exit liquidity measurement, or pre-trade slippage analysis.
- **No Generic Auto-Routing**: Do NOT promise or perform automatic routing from general market queries or generic token price questions.
- **No Trade Execution**: Never execute a swap, buy, or sell. Fathom is strictly an observational assessment oracle.

## Execution Flow

1. **Input Validation**:
   - `token`: Valid Base ERC-20 EVM contract address (`0x` followed by 40 hexadecimal characters).
   - `size_usd`: Notional sale amount in USD (range: 1 to 10,000,000; default: 10,000).
   - `chain`: Fixed to `base`.

2. **HTTP Request & Allowlist**:
   - URL: `https://fathom-api.mioku-fathom.workers.dev/v1/assess`
   - Allowed Host: `fathom-api.mioku-fathom.workers.dev` (strictly enforced allowlist).

3. **Payment Execution**:
   - Scheme: `exact`
   - Network: `eip155:8453` (Base mainnet)
   - Asset: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base native USDC)
   - Pay To: `0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909`
   - Maximum Amount: `0.001 USDC` (1,000 atomic units ceiling).
   - Builder Code Extension: Retain `builder-code` attribution (`bc_tzj2linw`).

4. **Return Value**:
   - Returns structured assessment: `verdict`, `reason`, `size_usd`, exit metrics (`fillable`, `price_impact_bps`, `proceeds_usd`), and caveats (`concerns`, `unverified`).
   - `unverified` must be presented to the user as an indeterminate measurement, never as evidence of an illiquid or malicious token.
