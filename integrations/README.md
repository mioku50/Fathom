# Fathom Integration Kit

The canonical integration layer for the [Fathom API](https://fathom-api.mioku-fathom.workers.dev).

Fathom provides real on-chain exit liquidity and risk assessments for Base ERC-20 tokens paid per call over the x402 protocol. This package delivers a single shared core client, one canonical response schema, a fail-closed x402 transport, and adapters for Coinbase AgentKit, LangChain, and CLI environments.

## Architecture

```
integrations/
├── src/
│   ├── core/           # Canonical client, Zod schemas, types, and typed errors
│   ├── x402/           # Official SDK transport with fail-closed policy enforcement
│   ├── agentkit/       # Coinbase AgentKit action provider
│   └── langchain/      # LangChain structured tool
├── bin/                # CLI tool (fathom-assess)
├── skills/fathom/      # Unified AgentSkill definition for Hermes & OpenClaw
├── base-mcp/           # Base MCP plugin candidate specification
└── examples/           # Runnable code examples
```

## Core Client & Schema

The core client handles input validation, URL parameter encoding, typed error mapping, and runtime Zod validation of response shapes.

```typescript
import { createFathomClient } from '@fathom/integrations';

const client = createFathomClient({ fetch: paidFetch });
const assessment = await client.assess({
  token: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  sizeUsd: 10000,
  chain: 'base'
});

console.log(assessment.verdict); // 'tradeable' | 'caution' | 'illiquid' | 'unverified'
```

### Canonical Response & Reduced Variant
Fathom returns a unified `FathomAssessment` shape. When a token cannot be priced on supported pools, Fathom returns an `unverified` assessment where `symbol` and `price_usd` are absent. The canonical Zod schema explicitly supports both full and reduced variants.

## Fail-Closed x402 Transport

Payment execution uses the official `@x402` SDK suite (`@x402/core`, `@x402/evm`, `@x402/fetch`). The transport enforces a strict fail-closed policy across all six dimensions:

1. **Scheme**: `exact`
2. **Network**: `eip155:8453` (Base mainnet)
3. **Asset**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base native USDC)
4. **Payee**: `0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909`
5. **Amount Ceiling**: `<= 1000` atomic units (0.001 USDC)
6. **Host & Path**: `https://fathom-api.mioku-fathom.workers.dev/v1/assess`

If any term fails to match, execution aborts before signing typed data (`signTypedData` is invoked 0 times). Fathom's declared `builder-code` attribution (`bc_tzj2linw`) is automatically preserved.

Dimension 6 is checked at **two independent gates**, and both must pass:

- the URL the request is actually being sent to, validated before the first byte leaves;
- the resource the 402 challenge advertises.

The second alone is not enough. A 402 challenge is supplied by whatever server answered, so a malicious host can advertise Fathom's canonical resource with otherwise canonical terms and still be the party that receives the signed payment. Checking only the advertised resource authorises exactly that split target. The request-side gate compares `URL.host`, so a non-default port does not pass, and requires `https:`. Query parameters are preserved and ignored — the canonical challenge resource is query-free while real requests carry `token` and `size_usd`.

None of the six terms is caller-configurable. A package that let callers replace `payTo`, the asset or the amount ceiling could not honestly call itself canonical or fail-closed. The single permitted adjustment is `maxAmountAtomic`, which may only **lower** the per-call ceiling below 1000 atomic units; raising it throws `FathomPaymentPolicyError`.

```typescript
import { createFathomX402Fetch, EvmSigner } from '@fathom/integrations';

const signer: EvmSigner = {
  address: account.address,
  signTypedData: (params) => account.signTypedData(params)
};

const fetchWithPayment = createFathomX402Fetch({ signer });
```

## AgentKit Action Provider

Exposes the `fathom_assess` action to AgentKit agents:

```typescript
import { AgentKit, ViemWalletProvider } from '@coinbase/agentkit';
import { fathomActionProvider } from '@fathom/integrations';

const agentKit = await AgentKit.from({
  walletProvider,
  actionProviders: [fathomActionProvider()]
});
```

- Restricted to Base mainnet.
- Never initiates or executes token swaps.

## LangChain Tool

Exposes `fathom_assess` as a LangChain `DynamicStructuredTool`:

```typescript
import { createFathomAssessTool, createFathomClient } from '@fathom/integrations';

const client = createFathomClient({ fetch: fetchWithPayment });
const tool = createFathomAssessTool({ client });
```

## CLI (`fathom-assess`)

Assess tokens directly from the terminal. Private keys must **never** be passed as CLI arguments; configure `FATHOM_PRIVATE_KEY` or `PRIVATE_KEY` in the environment.

```bash
export FATHOM_PRIVATE_KEY="0x..."
npx fathom-assess --token 0x940181a94A35A4569E4529A3CDfB74e38FD98631 --size-usd 10000
```

## Development & Verification

Inside `integrations/`:

```bash
npm run verify        # typecheck + build + full suite
```

or individually:

```bash
npm run typecheck
npm run build
npm test -- --run     # `pretest` builds first; the dist suite runs the artifact
```

The package ships as native ESM (`"type": "module"`, Node >= 18.17) with declared
`exports`. `test/dist_artifact.test.ts` executes the emitted JavaScript with plain
`node` — the CLI, the package entry, every subpath export, and the payment policy —
because a build that exits 0 while producing an unusable artifact is the failure
this suite exists to catch.

## License

[Apache-2.0](LICENSE). Apache rather than MIT for the explicit patent grant —
this package signs payments, and a client library that does that should carry
one.

The Fathom core service in the parent directory is licensed separately, under
[AGPL-3.0](../LICENSE). This package contains no code from it and imports
nothing from `src/`, which `test/license_boundary.test.ts` enforces, so
installing the kit brings no copyleft obligation with it.

Two documents here are additionally offered under MIT so they can be
contributed to upstream registries whose own licence is MIT — see
[NOTICE](NOTICE):

- `base-mcp/fathom.md`
- `skills/fathom/SKILL.md`
