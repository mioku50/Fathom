# Fathom — Jules/Codex Working Guide

Fathom is a Base long-tail token price oracle API. It provides price, liquidity, TWAP, confidence scoring and risk flags for tokens that are not covered by major oracle networks. The product is monetized through x402 USDC payments on Base.

## Source Priority

Before changing code, read these files in order:

1. `README.md`
2. `agent_tasks.json`
3. `docs/jules_autonomous_loop.md`
4. `docs/architecture.md`
5. `docs/codex_worker_plan.md`

Use `README.md` as the product source of truth and `agent_tasks.json` as the machine-readable task source of truth.

## Task Selection

Use the Fathom bridge when possible:

```bash
python -m fathom_agent.codex_bridge validate
python -m fathom_agent.codex_bridge status
python -m fathom_agent.codex_bridge next-task
python -m fathom_agent.codex_bridge render-prompt