# Fathom DEX Adapters

This document details how DEX adapters are implemented in Fathom and how new adapters can be integrated.

## Overview

DEX adapters are responsible for discovering token pools and fetching raw liquidity and pricing data from Decentralized Exchanges on the Base network. By standardizing the adapter interface, Fathom's pricing engine can seamlessly aggregate data from multiple sources without needing to know the specifics of each DEX's smart contracts.

## The `DEXAdapter` Interface

All adapters must implement the `DEXAdapter` interface defined in `src/dex_adapter.ts`:

```typescript
export interface PoolInfo {
  address: string;
  dex: string;
  fee?: number;
}

export interface RawPoolData {
  reserve0?: bigint;
  reserve1?: bigint;
  liquidity?: bigint;
  sqrtPriceX96?: bigint;
  tick?: number;
  updatedAt: number;
}

export interface DEXAdapter {
  readonly id: string;

  /**
   * Discover all relevant pools for a token.
   * @param tokenAddress The ERC-20 token contract address (0x...).
   * @returns A promise that resolves to an array of PoolInfo objects.
   */
  getPools(tokenAddress: string): Promise<PoolInfo[]>;

  /**
   * Fetch reserves, ticks, or state for price/liquidity calculation.
   * @param poolAddress The address of the pool contract.
   * @returns A promise that resolves to the raw data of the pool.
   */
  getRawData(poolAddress: string): Promise<RawPoolData>;
}
```

## Implementing a New Adapter

To add support for a new DEX (e.g., a new Uniswap fork or an entirely new AMM model):

1. **Create the Adapter Class**: Create a new file in `src/adapters/` (e.g., `src/adapters/my_new_dex.ts`).
2. **Implement the Interface**: Your class should implement `DEXAdapter`. Give it a unique `id` string.
3. **Use Viem**: Use the `viem` library for blockchain interactions. Pass a standard public client or an RPC URL via the constructor.
4. **Implement `getPools`**:
   - Given a token address, query the DEX's factory contract to find pools involving this token and common quote tokens (like WETH, USDC).
   - Return an array of `PoolInfo` containing the discovered pool addresses.
5. **Implement `getRawData`**:
   - Given a specific pool address discovered in the previous step, query the pool contract for its current state.
   - For V2-style AMMs, return `reserve0` and `reserve1`.
   - For V3-style concentrated liquidity AMMs, return `sqrtPriceX96`, `liquidity`, and optionally `tick`.
   - Include the current timestamp in `updatedAt`.

## Example: V2 Style vs V3 Style

Depending on the DEX type, the raw data returned varies:

- **V2 (e.g., Uniswap V2)**: Relies on `getReserves()` returning `reserve0` and `reserve1`. The price is calculated as a ratio of the reserves.
- **V3 (e.g., Uniswap V3, Aerodrome CL)**: Relies on `slot0()` returning `sqrtPriceX96` and `liquidity()`. The price is derived from `sqrtPriceX96`.

## Integrating the Adapter

Once the adapter is written:

1. Import your new adapter in `src/orchestrator.ts` or wherever adapters are initialized.
2. Add an instance of your adapter to the list of active adapters used by the pricing engine.
3. The orchestrator will automatically call `getPools()` and `getRawData()` on your adapter when calculating prices for a token.

## Testing

Ensure that new adapters are covered by unit tests. Mock the `viem` public client to simulate RPC responses for pool discovery and raw data fetching. See existing tests in `tests/` for reference.
