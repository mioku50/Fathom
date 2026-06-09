# Fathom Pricing Engine

The pricing engine is responsible for orchestrating price discovery by querying DEX adapters, calculating TWAP, evaluating liquidity depth, and assigning a confidence score to the derived price.

## DEX Adapter Architecture

Fathom interacts with different decentralized exchanges (DEXs) through standardized adapters. Examples include Aerodrome (v2 + Slipstream) and Uniswap (v2, v3, v4).

Each adapter implements the `DEXAdapter` interface, providing a unified way to fetch data across various protocols:

```typescript
interface DEXAdapter {
  readonly id: string;
  getPools(tokenAddress: string): Promise<Pool[]>;
  getRawData(poolAddress: string): Promise<RawPoolData>;
}
```

- **`id`**: A unique string identifying the adapter (e.g., `"aerodrome"`, `"uniswap_v3"`).
- **`getPools(tokenAddress)`**: Discovers all relevant liquidity pools for a given token programmatically by interacting with Factory and Registry contracts.
- **`getRawData(poolAddress)`**: Fetches the underlying pool state such as reserves, current ticks, or active liquidity to be used for price and liquidity depth calculations.

## Confidence Scoring

Every calculated price comes with a 0-100 confidence score, representing the reliability and robustness of the data.

The confidence score is computed using a weighted formula based on five factors:

**`Confidence = 0.35 * S_liq + 0.20 * S_src + 0.20 * S_twap + 0.15 * S_sigma + 0.10 * S_mat`**

- **`S_liq` (Liquidity depth - 35%)**: Measures the TVL and slippage depth (the amount of capital required to move the price by 1%). High liquidity yields a higher score.
- **`S_src` (Price consistency across sources - 20%)**: Evaluates how closely the prices from different pools or DEXs align. Less deviation means higher consistency.
- **`S_twap` (Spot vs. TWAP deviation - 20%)**: Compares the current spot price against the Time-Weighted Average Price (typically a 5m window). A smaller deviation results in a higher score.
- **`S_sigma` (Price volatility/uncertainty - 15%)**: Assesses the recent price volatility. Lower volatility implies higher certainty and a better score.
- **`S_mat` (Market maturity - 10%)**: Considers the age of the pool and its historical trading volume. More mature pools score higher.

### Risk Flags

In addition to the base score, hard ceilings (risk flags) may be applied to cap the confidence score under specific conditions:

- **`thin_liquidity`**: Liquidity is below the required minimum threshold.
- **`possible_manipulation`**: A large deviation exists between the spot price and the TWAP.
- **`single_pool`**: Data is derived from only one liquidity source.
- **`stale`**: Data is outdated or the RPC nodes are unresponsive.
- **`unsellable`**: Sell simulations fail (e.g., possible honeypot token).
