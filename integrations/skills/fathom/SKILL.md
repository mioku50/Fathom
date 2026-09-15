---
name: fathom
description: Assess exit liquidity, pre-trade risk, and position sizing for Base tokens before entering a trade. Use this skill when deciding "can I sell this Base token", "exit liquidity", "slippage before buying", "can I exit a $10k position", or evaluating real on-chain exit depth across Base DEXes.
---

# Fathom Pre-Trade Exit Assessment

Fathom quotes real on-chain sales across Base DEXes (Aerodrome, Aerodrome Slipstream, Uniswap V2, V3, and V4) and returns a single branchable verdict on whether a position can be safely exited.

## When to Reach for Fathom

Invoke Fathom when:
- Evaluating "can I sell this Base token" or "is there exit liquidity" before committing funds.
- Checking "slippage before buying" or determining "can I exit a $10k position" (or custom position size).
- Sizing positions and assessing pre-trade risk on Base ERC-20 tokens.

Do NOT reach for Fathom simply as a generic price ticker when exit liquidity and slippage are not concerns.

## Cost & Protocol

- **Endpoint**: `/v1/assess`
- **Cost**: Exactly `0.001 USDC` (max 1000 atomic units) per call via x402 on Base mainnet (`eip155:8453`).
- **Chain**: Base mainnet only (`chain=base`).

## Verdicts

Fathom returns one branchable verdict:
- `tradeable`: The position fills with acceptable slippage against corroborated on-chain liquidity.
- `caution`: The position fills, but incurs high slippage (>100 bps) worth surfacing before trading.
- `illiquid`: The sale cannot be filled at the requested size or costs over 10% (>1000 bps) in slippage.
- `unverified`: Fathom could not measure enough sources to render a verdict.

### Critical Rule on `unverified`
`unverified` is never a negative verdict and never proof that a token lacks a pool or liquidity. It simply means the reading could not be corroborated. Do not treat `unverified` as an adversarial flag against the token.

## Important Safety Constraints

1. **No Scam or Honeypot Claims**: Fathom is an exit liquidity and price oracle. It makes no claim of scam or honeypot protection; sellability and transfer taxes are not simulated.
2. **No Automatic Second Paid Retry**: Never run an automatic second paid retry in a loop if a call returns unverified or fails.
3. **Never Ask for a Private Key in Chat**: Private keys must never be requested, logged, or exposed in conversational prompts. Keys remain strictly within wallet providers or environment variables.
4. **Never Execute a Swap**: Fathom is an observational risk oracle. It never executes swaps or transactions on the user's behalf.

## Execution Priority

When an agent needs to execute an assessment:
1. **Runtime-native x402 tool**: Use native AgentKit action `fathom_assess` or LangChain tool `fathom_assess` if the environment provides a payment-enabled wallet provider.
2. **Local CLI**: Use `fathom-assess --token 0x... --size-usd <amount>` with `FATHOM_PRIVATE_KEY` configured in the environment.
3. **Stop & Explain**: If neither is available, stop and explain to the user that a payment-capable x402 runtime or private key configuration is needed.
