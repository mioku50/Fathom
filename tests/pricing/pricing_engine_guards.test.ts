import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingEngine, __clearAnchorMemo } from '../../src/pricing_engine';
import { PricingError } from '../../src/errors';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TOKEN = '0x1111111111111111111111111111111111111111';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

const WETH_USDC_POOL = { address: '0xpoolwethusdc', dex: 'aerodrome', fee: 0.003 };
const TOKEN_WETH_POOL = { address: '0xpooltokenweth', dex: 'aerodrome', fee: 0.003 };
const TOKEN_USDC_POOL = { address: '0xpooltokenusdc', dex: 'aerodrome', fee: 0.003 };
const TOKEN_USDC_POOL_2 = { address: '0xpooltokenusdc2', dex: 'uniswap_v2', fee: 0.003 };
const EMPTY_POOL_A = { address: '0xemptya', dex: 'aerodrome', fee: 0.0005 };
const EMPTY_POOL_B = { address: '0xemptyb', dex: 'uniswap_v2', fee: 0.003 };

// 1 WETH <-> 3000 USDC
const wethUsdcRaw = {
  token0: WETH,
  token1: USDC,
  reserve0: 1_000_000_000_000_000_000n,
  reserve1: 3_000_000_000n,
  updatedAt: 12345
};

// 1000 TOKEN <-> 1 WETH  => 0.001 WETH each
const tokenWethRaw = {
  token0: TOKEN,
  token1: WETH,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 1_000_000_000_000_000_000n,
  updatedAt: 12345
};

// 1000 TOKEN <-> 5000 USDC => $5 each
const tokenUsdcRaw = {
  token0: TOKEN,
  token1: USDC,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 5_000_000_000n,
  updatedAt: 12345
};

// 1000 TOKEN <-> 5100 USDC => $5.10 each, i.e. 2% above TOKEN_USDC_POOL
const tokenUsdcRaw2 = {
  token0: TOKEN,
  token1: USDC,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 5_100_000_000n,
  updatedAt: 12345
};

// A deployed but empty pool - discoverable, but not a price source.
const emptyRaw = {
  token0: TOKEN,
  token1: USDC,
  reserve0: 0n,
  reserve1: 0n,
  updatedAt: 12345
};

const TOKEN_USDC_V3_POOL = { address: '0xpoolv3', dex: 'uniswap_v3', fee: 0.003 };
const TOKEN_USDC_STABLE_POOL = { address: '0xpoolstable', dex: 'aerodrome', fee: 0.0005, stable: true };

// Concentrated liquidity: sqrtPriceX96 + L, no reserves.
const tokenUsdcV3Raw = {
  token0: TOKEN,
  token1: USDC,
  sqrtPriceX96: 79228162514264337593543950336n,
  liquidity: 5_000_000_000_000_000_000n,
  tick: 0,
  updatedAt: 12345
};

const AERO_USDC_POOL = { address: '0xpoolaerousdc', dex: 'aerodrome', fee: 0.003 };
const TOKEN_AERO_POOL = { address: '0xpooltokenaero', dex: 'aerodrome', fee: 0.003 };

// 1000 AERO <-> 500 USDC => $0.50 per AERO
const aeroUsdcRaw = {
  token0: AERO,
  token1: USDC,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 500_000_000n,
  updatedAt: 12345
};

// 1000 TOKEN <-> 4000 AERO => 4 AERO each => $2.00
const tokenAeroRaw = {
  token0: TOKEN,
  token1: AERO,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 4_000_000_000_000_000_000_000n,
  updatedAt: 12345
};

function makeOrchestrator(
  poolsByToken: Record<string, any[]>,
  rawByPool: Record<string, any>,
  // Default: no quoter wired up for this DEX, i.e. depth stays unknown.
  quoteSell: (req: any) => Promise<(bigint | null)[] | null> = async () => null,
  // Default: the pool has no usable oracle, i.e. TWAP stays unmeasured.
  getTwapAmountOut: (req: any) => Promise<any> = async () => null
) {
  return {
    getAllPools: vi.fn(async (token: string) => poolsByToken[token.toLowerCase()] ?? []),
    getAllRawData: vi.fn(async (pools: any[]) =>
      pools
        .filter(p => rawByPool[p.address])
        .map(p => ({ pool: p, rawData: rawByPool[p.address] }))
    ),
    quoteSell: vi.fn(quoteSell),
    getTwapAmountOut: vi.fn(getTwapAmountOut)
  } as any;
}

function makeRpc(overrides: Record<string, unknown> = {}) {
  return {
    getTokenDecimals: vi.fn(async (address: string) =>
      address.toLowerCase() === USDC.toLowerCase() ? 6 : 18
    ),
    getTokenSymbol: vi.fn(async () => 'TKN'),
    ...overrides
  } as any;
}

// The anchor memo is module state that deliberately outlives a request, which
// is exactly why each test has to start from a fresh isolate.
beforeEach(() => __clearAnchorMemo());

describe('PricingEngine guards', () => {
  it('prices a WETH-quoted token through the WETH/USD anchor', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // 0.001 WETH * $3000
    expect(res!.price_usd).toBeCloseTo(3.0, 8);
  });

  it('throws stale_anchor instead of pricing WETH-quoted pools at a $1 anchor', async () => {
    // No WETH/USDC pool at all -> the anchor cannot be established.
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL] },
      { [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await expect(engine.calculatePrice(TOKEN)).rejects.toBeInstanceOf(PricingError);
    await expect(engine.calculatePrice(TOKEN)).rejects.toMatchObject({ code: 'stale_anchor' });
  });

  it('still prices from a USDC pool when the WETH anchor is unavailable', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL, TOKEN_USDC_POOL] },
      { [TOKEN_WETH_POOL.address]: tokenWethRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(res!.price_usd).toBeCloseTo(5.0, 8);
  });

  it('returns null (no_liquidity) rather than stale_anchor when there are no pools', async () => {
    const orchestrator = makeOrchestrator({ [WETH.toLowerCase()]: [], [TOKEN.toLowerCase()]: [] }, {});
    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await expect(engine.calculatePrice(TOKEN)).resolves.toBeNull();
  });

  it('propagates unknown_decimals instead of assuming 18', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const rpc = makeRpc({
      getTokenDecimals: vi.fn(async (address: string) => {
        if (address.toLowerCase() === USDC.toLowerCase()) return 6;
        throw new PricingError('unknown_decimals', `Could not read decimals() for token ${address}`);
      })
    });

    const engine = new PricingEngine(orchestrator, rpc, 'base');
    await expect(engine.calculatePrice(TOKEN)).rejects.toMatchObject({ code: 'unknown_decimals' });
  });

  it('reports USDC on the same 0-100 confidence scale as every other token', async () => {
    const orchestrator = makeOrchestrator({}, {});
    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    const res = await engine.calculatePrice(USDC);

    expect(res).not.toBeNull();
    expect(res!.price_usd).toBe(1.0);
    expect(res!.confidence).toBe(100);
    expect(res!.label).toBe('reliable');
    expect(res!.flags).toContain('hardcoded_numeraire');
  });

  it('never emits fabricated TWAP or uncertainty-band fields', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    for (const field of ['twap_5m', 'price_low', 'price_high']) {
      expect(field in (res as object)).toBe(false);
    }
  });
  it('counts only pools that actually priced the token, so empty fee tiers no longer suppress single_pool', () => {
    // Three pools discovered, two of them empty. Before this, num_pools was the
    // discovered count, so the single_pool ceiling never fired for a token whose
    // price came from exactly one live venue.
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL, EMPTY_POOL_A, EMPTY_POOL_B]
      },
      {
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw,
        [EMPTY_POOL_A.address]: emptyRaw,
        [EMPTY_POOL_B.address]: emptyRaw
      }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    return engine.calculatePrice(TOKEN).then(res => {
      expect(res).not.toBeNull();
      expect(res!.source_count).toBe(1);
      expect(res!.flags).toContain('single_pool');
      expect(res!.confidence).toBeLessThanOrEqual(69);
    });
  });

  it('measures real dispersion between two disagreeing sources', async () => {
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL, TOKEN_USDC_POOL_2]
      },
      {
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw,
        [TOKEN_USDC_POOL_2.address]: tokenUsdcRaw2
      }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(res!.source_count).toBe(2);
    expect(res!.flags).not.toContain('single_pool');

    // $5.00 vs $5.10 around a liquidity-weighted mean of ~$5.0505 => ~100 bps
    expect(res!.price_dispersion_bps).toBeGreaterThan(90);
    expect(res!.price_dispersion_bps).toBeLessThan(110);

    // source agreement and volatility are now real measurements
    expect(res!.confidence_components.source_agreement.score).not.toBeNull();
    expect(res!.confidence_components.volatility.score).not.toBeNull();
  });

  it('marks the checks it did not run rather than scoring them as healthy', async () => {
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL, TOKEN_USDC_POOL_2]
      },
      {
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw,
        [TOKEN_USDC_POOL_2.address]: tokenUsdcRaw2
      }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(res!.flags).toContain('twap_unavailable');
    expect(res!.flags).toContain('freshness_unchecked');
    expect(res!.flags).toContain('sellability_unchecked');

    // TWAP and maturity contribute nothing while unmeasured
    expect(res!.confidence_components.twap_deviation.score).toBeNull();
    expect(res!.confidence_components.twap_deviation.effective_weight).toBe(0);
    expect(res!.confidence_components.maturity.score).toBeNull();

    // the missing check is reported through flags, not by capping the score
    expect(res!.confidence).toBeGreaterThan(0);
  });

  it('reports dispersion as null when there is only one source', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.price_dispersion_bps).toBeNull();
    expect(res!.confidence_components.source_agreement.score).toBeNull();
  });
  it('resolves the WETH/USD anchor once per engine, not once per token', async () => {
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL]
      },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await engine.calculatePrice(TOKEN);
    await engine.calculatePrice(TOKEN);
    await engine.calculatePrice(TOKEN);

    const wethLookups = orchestrator.getAllPools.mock.calls.filter(
      ([t]: [string]) => t.toLowerCase() === WETH.toLowerCase()
    );
    expect(wethLookups).toHaveLength(1);
  });

  it('shares one in-flight anchor lookup between concurrently priced tokens', async () => {
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL]
      },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    // Started together, so a value-memoized anchor would still race; only
    // memoizing the promise collapses these into one lookup.
    await Promise.all([
      engine.calculatePrice(TOKEN),
      engine.calculatePrice(TOKEN),
      engine.calculatePrice(TOKEN)
    ]);

    const wethLookups = orchestrator.getAllPools.mock.calls.filter(
      ([t]: [string]) => t.toLowerCase() === WETH.toLowerCase()
    );
    expect(wethLookups).toHaveLength(1);
  });
  it('quotes real executable depth for a constant-product main pool', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(res!.sell_quotes.map(q => q.size_usd)).toEqual([1000, 5000, 10000]);

    // 1000 TOKEN <-> 5000 USDC is a shallow pool: $10k out of it hurts badly,
    // and every size must cost more than the one before it.
    const impacts = res!.sell_quotes.map(q => q.price_impact_bps!);
    expect(impacts.every(i => i > 0)).toBe(true);
    expect(impacts[0]).toBeLessThan(impacts[1]);
    expect(impacts[1]).toBeLessThan(impacts[2]);

    // proceeds are strictly less than the notional asked for
    for (const q of res!.sell_quotes) {
      expect(q.proceeds_usd!).toBeLessThan(q.size_usd);
    }

    expect(res!.depth_1pct_usd).not.toBeNull();
    expect(res!.depth_5pct_usd!).toBeGreaterThan(res!.depth_1pct_usd!);
    expect(res!.flags).not.toContain('depth_unavailable');
  });

  it('quotes a concentrated-liquidity pool through the DEX quoter', async () => {
    // QuoterV2 simulates the swap for real, so tick crossing is accounted for.
    // Return 4%, 4.5% and 6% shortfalls against the $1k/$5k/$10k notionals.
    const shortfalls = [0.96, 0.955, 0.94];
    let call = 0;

    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_V3_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_V3_POOL.address]: tokenUsdcV3Raw },
      async ({ amountsIn }: any) =>
        amountsIn.map((_: bigint, i: number) => {
          call++;
          // USDC has 6 decimals; proceeds = size * shortfall
          return BigInt(Math.floor([1000, 5000, 10000][i] * shortfalls[i] * 1e6));
        })
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(orchestrator.quoteSell).toHaveBeenCalledTimes(1);
    expect(call).toBe(3);

    expect(res!.sell_quotes.map(q => q.proceeds_usd)).toEqual([960, 4775, 9400]);
    // impact grows with size and matches the quoted shortfall
    expect(res!.sell_quotes[0].price_impact_bps).toBeCloseTo(400, 6);
    expect(res!.sell_quotes[2].price_impact_bps).toBeCloseTo(600, 6);
    expect(res!.flags).not.toContain('depth_unavailable');

    // the router cannot be cheaply inverted for these, so they stay null
    expect(res!.depth_1pct_usd).toBeNull();
    expect(res!.depth_5pct_usd).toBeNull();
  });

  it('reports a size the quoter could not fill as null rather than zero', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_V3_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_V3_POOL.address]: tokenUsdcV3Raw },
      // $1k fills, larger sizes revert for want of liquidity
      async () => [BigInt(960 * 1e6), null, null]
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.sell_quotes[0].proceeds_usd).toBe(960);
    expect(res!.sell_quotes[1].proceeds_usd).toBeNull();
    expect(res!.sell_quotes[2].proceeds_usd).toBeNull();
    // partial information is still information
    expect(res!.flags).not.toContain('depth_unavailable');
  });

  it('refuses to invent depth when no quoter answers', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_V3_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_V3_POOL.address]: tokenUsdcV3Raw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // priced fine, but exit liquidity is a different question
    expect(res!.price_usd).toBeGreaterThan(0);
    expect(res!.depth_1pct_usd).toBeNull();
    expect(res!.sell_quotes.every(q => q.proceeds_usd === null)).toBe(true);
    expect(res!.flags).toContain('depth_unavailable');
  });

  it('routes an Aerodrome stable pool to the router instead of applying x*y=k', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_STABLE_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_STABLE_POOL.address]: tokenUsdcRaw },
      async ({ amountsIn }: any) => amountsIn.map(() => BigInt(999 * 1e6))
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // reserves are present, but the curve is x3y+y3x - constant product would lie,
    // so the quoter is consulted even though reserves were available
    expect(orchestrator.quoteSell).toHaveBeenCalledTimes(1);
    expect(orchestrator.quoteSell.mock.calls[0][0].pool.stable).toBe(true);
    expect(res!.sell_quotes[0].proceeds_usd).toBe(999);
    // closed-form depth still does not apply to this curve
    expect(res!.depth_1pct_usd).toBeNull();
  });

  it('converts depth through the WETH anchor for a WETH-quoted pool', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    // pool holds 1 WETH = $3000, so 1% depth is a small dollar figure, not a WETH figure
    expect(res!.depth_1pct_usd).not.toBeNull();
    expect(res!.depth_1pct_usd!).toBeGreaterThan(0);
    expect(res!.depth_1pct_usd!).toBeLessThan(6000);
  });

  it('reports no depth for the hardcoded USDC response', async () => {
    const engine = new PricingEngine(makeOrchestrator({}, {}), makeRpc(), 'base');
    const res = await engine.calculatePrice(USDC);

    expect(res!.depth_1pct_usd).toBeNull();
    expect(res!.sell_quotes.every(q => q.proceeds_usd === null)).toBe(true);
  });
  it('excludes V3 pseudo-TVL from both the score and the response', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_V3_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_V3_POOL.address]: tokenUsdcV3Raw },
      async ({ amountsIn }: any) =>
        amountsIn.map((_: bigint, i: number) => BigInt(Math.floor([990, 4900, 9700][i] * 1e6)))
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // L * sqrtP is an active-range parameter, not a balance - so we report none
    expect(res!.liquidity_usd).toBeNull();
    expect(res!.confidence_components.liquidity.score).toBeNull();
    expect(res!.flags).toContain('liquidity_unmeasured');

    // ...but execution quality is real, and carries the weight instead
    expect(res!.confidence_components.execution_quality.score).not.toBeNull();
    expect(res!.confidence_components.execution_quality.effective_weight).toBeGreaterThan(0);
  });

  it('keeps reporting liquidity for pools that hold real balances', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.liquidity_usd).toBeGreaterThan(0);
    expect(res!.confidence_components.liquidity.score).not.toBeNull();
    expect(res!.flags).not.toContain('liquidity_unmeasured');
  });

  it('flags a token whose headline sale cannot be filled at all', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_V3_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_V3_POOL.address]: tokenUsdcV3Raw },
      // only the smallest size fills
      async () => [BigInt(995 * 1e6), null, null]
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.flags).toContain('no_exit_liquidity');
    expect(res!.confidence).toBeLessThanOrEqual(39);
    expect(res!.confidence_components.execution_quality.score).toBe(0);
  });
  it('measures spot against the pool oracle and feeds it to confidence', async () => {
    // Pool prices TOKEN at $5.00 spot; the oracle averages $5.10 => 196 bps apart
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw },
      async () => null,
      async ({ amountIn }: any) => {
        // one whole TOKEN in (18 dp) -> 5.10 USDC out (6 dp)
        expect(amountIn).toBe(10n ** 18n);
        return { amountOut: BigInt(5_100_000), windowSeconds: 300 };
      }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.twap.price_usd).toBeCloseTo(5.1, 9);
    expect(res!.twap.window_seconds).toBe(300);
    // |5.00 - 5.10| / 5.10 = 1.96%
    expect(res!.twap.spot_deviation_bps).toBeCloseTo(196.078, 2);

    // the component is now measured rather than excluded
    expect(res!.confidence_components.twap_deviation.score).not.toBeNull();
    expect(res!.flags).not.toContain('twap_unavailable');
  });

  it('raises possible_manipulation when spot runs far from the oracle', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw },
      async () => null,
      // oracle says $1.00 while spot is $5.00 - a 400% gap
      async () => ({ amountOut: BigInt(1_000_000), windowSeconds: 300 })
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.flags).toContain('possible_manipulation');
    expect(res!.confidence).toBeLessThanOrEqual(39);
    expect(res!.confidence_components.twap_deviation.score).toBe(0);
  });

  it('leaves TWAP unmeasured when the pool oracle cannot answer', async () => {
    // Cardinality 1 is the default for a fresh pool, so this is the common case
    // on exactly the long-tail tokens Fathom prices.
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.twap.price_usd).toBeNull();
    expect(res!.twap.window_seconds).toBeNull();
    expect(res!.twap.spot_deviation_bps).toBeNull();
    expect(res!.flags).toContain('twap_unavailable');
    expect(res!.confidence_components.twap_deviation.score).toBeNull();
  });

  it('reports the window the oracle actually used, not the one requested', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_POOL.address]: tokenUsdcRaw },
      async () => null,
      // Aerodrome v2 averages over its own periodSize, not our 300s request
      async () => ({ amountOut: BigInt(5_000_000), windowSeconds: 1800 })
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res!.twap.window_seconds).toBe(1800);
    expect(res!.twap.spot_deviation_bps).toBeCloseTo(0, 6);
  });
  it('prices an AERO-quoted token by hopping AERO -> USDC', async () => {
    const orchestrator = makeOrchestrator(
      {
        [AERO.toLowerCase()]: [AERO_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_AERO_POOL]
      },
      { [AERO_USDC_POOL.address]: aeroUsdcRaw, [TOKEN_AERO_POOL.address]: tokenAeroRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // 4 AERO x $0.50
    expect(res!.price_usd).toBeCloseTo(2.0, 8);
  });

  it('raises stale_anchor when the AERO anchor cannot be established', async () => {
    const orchestrator = makeOrchestrator(
      { [AERO.toLowerCase()]: [], [TOKEN.toLowerCase()]: [TOKEN_AERO_POOL] },
      { [TOKEN_AERO_POOL.address]: tokenAeroRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await expect(engine.calculatePrice(TOKEN)).rejects.toMatchObject({ code: 'stale_anchor' });
  });

  it('resolves no anchor at all for a token quoted only in USDC', async () => {
    const orchestrator = makeOrchestrator(
      { [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    await engine.calculatePrice(TOKEN);

    // anchors are lazy: nothing but the token itself should have been looked up
    const lookedUp = orchestrator.getAllPools.mock.calls.map(([t]: [string]) => t.toLowerCase());
    expect(lookedUp).toEqual([TOKEN.toLowerCase()]);
  });

  it('resolves each quote anchor once, however many pools use it', async () => {
    const orchestrator = makeOrchestrator(
      {
        [AERO.toLowerCase()]: [AERO_USDC_POOL],
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_AERO_POOL, TOKEN_WETH_POOL, TOKEN_USDC_POOL]
      },
      {
        [AERO_USDC_POOL.address]: aeroUsdcRaw,
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        [TOKEN_AERO_POOL.address]: tokenAeroRaw,
        [TOKEN_WETH_POOL.address]: tokenWethRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw
      }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    await engine.calculatePrice(TOKEN);
    await engine.calculatePrice(TOKEN);

    const counts = (addr: string) =>
      orchestrator.getAllPools.mock.calls.filter(([t]: [string]) => t.toLowerCase() === addr.toLowerCase()).length;

    expect(counts(AERO)).toBe(1);
    expect(counts(WETH)).toBe(1);
    // three independent sources now that AERO-quoted pools are priced
    const res = await engine.calculatePrice(TOKEN);
    expect(res!.source_count).toBe(3);
  });
  it('moves to another pool when the deepest-looking one cannot fill the trade', async () => {
    // Two concentrated-liquidity pools. The one that ranks highest by the
    // L * sqrtP heuristic cannot quote; the other can. Ranking must not be the
    // last word, because that heuristic is the number we refuse to report.
    const DEEP_LOOKING = { address: '0xdeeplooking', dex: 'uniswap_v3', fee: 0.0001 };
    const ACTUALLY_FILLABLE = { address: '0xfillable', dex: 'uniswap_v3', fee: 0.003 };

    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [DEEP_LOOKING, ACTUALLY_FILLABLE]
      },
      {
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        // bigger L, so it sorts first
        [DEEP_LOOKING.address]: { ...tokenUsdcV3Raw, liquidity: 900_000_000_000_000_000_000n },
        [ACTUALLY_FILLABLE.address]: tokenUsdcV3Raw
      },
      async ({ pool, amountsIn }: any) =>
        pool.address === ACTUALLY_FILLABLE.address
          ? amountsIn.map((_: bigint, i: number) => BigInt(Math.floor([980, 4900, 9800][i] * 1e6)))
          : amountsIn.map(() => null)
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    expect(orchestrator.quoteSell).toHaveBeenCalledTimes(2);
    // the venue that can execute is the one reported
    expect(res!.main_pool.address).toBe(ACTUALLY_FILLABLE.address);
    expect(res!.sell_quotes[2].proceeds_usd).toBe(9800);
    expect(res!.flags).not.toContain('depth_unavailable');
  });

  it('stops after a bounded number of candidates', async () => {
    const pools = Array.from({ length: 6 }, (_, i) => ({
      address: `0xpool${i}`, dex: 'uniswap_v3', fee: 0.003
    }));
    const raw = Object.fromEntries(pools.map(p => [p.address, tokenUsdcV3Raw]));

    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: pools },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, ...raw },
      async () => null // nothing can be quoted
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    // six candidates, but we do not pay for six quoter round trips
    expect(orchestrator.quoteSell).toHaveBeenCalledTimes(3);
    expect(res!.flags).toContain('depth_unavailable');
  });
  it('reports unreadable pools as an rpc failure, not as absent liquidity', async () => {
    // Discovery works, every read is throttled. Saying "no liquidity" about a
    // token that has plenty is a wrong answer; an error is merely unavailable.
    const orchestrator = {
      getAllPools: vi.fn(async () => [TOKEN_USDC_POOL, TOKEN_WETH_POOL]),
      getAllRawData: vi.fn(async () => []),
      quoteSell: vi.fn(async () => null),
      getTwapAmountOut: vi.fn(async () => null)
    } as any;

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await expect(engine.calculatePrice(TOKEN)).rejects.toMatchObject({ code: 'rpc_error' });
  });

  it('still reports genuinely empty tokens as having no liquidity', async () => {
    const orchestrator = makeOrchestrator({ [TOKEN.toLowerCase()]: [] }, {});
    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await expect(engine.calculatePrice(TOKEN)).resolves.toBeNull();
  });
});

describe('cold-path cost', () => {
  const anchoredSetup = () =>
    makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL]
      },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

  it('establishes decimals before spending anything on discovery', async () => {
    const orchestrator = anchoredSetup();
    const rpc = makeRpc({
      getTokenDecimals: vi.fn(async () => {
        throw new PricingError('unknown_decimals', 'Could not read decimals()');
      })
    });

    const engine = new PricingEngine(orchestrator, rpc, 'base');
    await expect(engine.calculatePrice(TOKEN)).rejects.toMatchObject({ code: 'unknown_decimals' });

    // Decimals used to be read after discovery and the pool reads - the busiest
    // moment of the request, and the one most likely to be throttled. A token
    // we cannot scale should cost one call to reject, not fifty.
    expect(orchestrator.getAllPools).not.toHaveBeenCalled();
    expect(orchestrator.getAllRawData).not.toHaveBeenCalled();
  });

  it('resolves the USD anchor once across separate requests', async () => {
    const orchestrator = anchoredSetup();
    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');

    await engine.calculatePrice(TOKEN);
    const wethLookupsAfterFirst = orchestrator.getAllPools.mock.calls.filter(
      (c: any[]) => c[0].toLowerCase() === WETH.toLowerCase()
    ).length;

    // A second engine, as a second request would build.
    const second = new PricingEngine(orchestrator, makeRpc(), 'base');
    await second.calculatePrice(TOKEN);

    const wethLookupsTotal = orchestrator.getAllPools.mock.calls.filter(
      (c: any[]) => c[0].toLowerCase() === WETH.toLowerCase()
    ).length;

    expect(wethLookupsAfterFirst).toBe(1);
    // Resolving an anchor is a full nested pricing pass. WETH is worth the same
    // to every token, so paying for it once per request was pure waste.
    expect(wethLookupsTotal).toBe(1);
  });

  it('still prices correctly from the memoised anchor', async () => {
    const orchestrator = anchoredSetup();
    const first = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);
    const second = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    expect(first!.price_usd).toBeCloseTo(3, 10);
    expect(second!.price_usd).toBe(first!.price_usd);
  });

  it('re-resolves the anchor once the memo has expired', async () => {
    vi.useFakeTimers();
    try {
      const orchestrator = anchoredSetup();
      await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

      vi.advanceTimersByTime(31_000);

      await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

      const wethLookups = orchestrator.getAllPools.mock.calls.filter(
        (c: any[]) => c[0].toLowerCase() === WETH.toLowerCase()
      ).length;
      // An anchor rescales every price quoted against it, so it is held for
      // seconds, not for the life of the isolate.
      expect(wethLookups).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not memoise an anchor it could not resolve', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL] },
      { [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    await expect(
      new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN)
    ).rejects.toMatchObject({ code: 'stale_anchor' });

    // Caching a failure would turn one bad moment into thirty seconds of them.
    await expect(
      new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN)
    ).rejects.toMatchObject({ code: 'stale_anchor' });

    const wethLookups = orchestrator.getAllPools.mock.calls.filter(
      (c: any[]) => c[0].toLowerCase() === WETH.toLowerCase()
    ).length;
    expect(wethLookups).toBe(2);
  });
});

describe('partial market reads', () => {
  const twentyPools = Array.from({ length: 20 }, (_, i) => ({
    address: `0xpool${i}`,
    dex: 'aerodrome',
    fee: 0.003
  }));

  // One dust pool: 1000 TOKEN against 0.1 USDC, i.e. a ruinous exit.
  const dustRaw = {
    token0: TOKEN,
    token1: USDC,
    reserve0: 1_000_000_000_000_000_000_000n,
    reserve1: 100_000n,
    updatedAt: 12345
  };

  function orchestratorReading(readable: string[], raw: any) {
    return {
      getAllPools: vi.fn(async (t: string) =>
        t.toLowerCase() === TOKEN.toLowerCase() ? twentyPools : []
      ),
      getAllRawData: vi.fn(async (pools: any[]) =>
        pools.filter(p => readable.includes(p.address)).map(p => ({ pool: p, rawData: raw }))
      ),
      quoteSell: vi.fn(async () => null),
      getTwapAmountOut: vi.fn(async () => null)
    } as any;
  }

  it('caps confidence when it could only read a fraction of the market', async () => {
    // Twenty pools discovered, one read, and that one is dust: a ruinous exit
    // measured on a twentieth of the market.
    const orchestrator = orchestratorReading(['0xpool0'], dustRaw);
    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    expect(res!.flags).toContain('incomplete_pool_coverage');
    expect(res!.confidence).toBeLessThanOrEqual(49);
  });

  it('withdraws the no-exit verdict rather than publishing it on partial data', async () => {
    // Concentrated liquidity whose quoter cannot fill the headline size: exit
    // liquidity is measured as absent, which normally earns no_exit_liquidity.
    const orchestrator = {
      getAllPools: vi.fn(async (t: string) =>
        t.toLowerCase() === TOKEN.toLowerCase() ? twentyPools : []
      ),
      getAllRawData: vi.fn(async (pools: any[]) =>
        pools.filter(p => p.address === '0xpool0').map(p => ({ pool: p, rawData: tokenUsdcV3Raw }))
      ),
      // $1k fills, $5k and $10k do not: the quoter answered, and the answer is
      // that the advertised exit size cannot be filled.
      quoteSell: vi.fn(async () => [900_000_000n, null, null]),
      getTwapAmountOut: vi.fn(async () => null)
    } as any;

    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    // "There is no way out" is a claim about the market. We saw a twentieth of it.
    expect(res!.flags).toContain('incomplete_pool_coverage');
    expect(res!.flags).not.toContain('no_exit_liquidity');
    expect(res!.flags).toContain('exit_liquidity_unverified');
    expect(res!.confidence).toBeGreaterThan(0);
  });

  it('says nothing about coverage when most of the market was read', async () => {
    const readable = twentyPools.slice(0, 15).map(p => p.address);
    const orchestrator = orchestratorReading(readable, tokenUsdcRaw);
    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    expect(res!.flags).not.toContain('incomplete_pool_coverage');
    expect(res!.flags).not.toContain('exit_liquidity_unverified');
  });

  it('still condemns a token whose market it did read', async () => {
    // Every pool readable, and every one of them dust: now the verdict is earned.
    const readable = twentyPools.map(p => p.address);
    const orchestrator = orchestratorReading(readable, dustRaw);
    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    expect(res!.flags).not.toContain('incomplete_pool_coverage');
    expect(res!.confidence).toBeLessThanOrEqual(49);
  });

  it('treats a token with a single discovered pool as fully read', async () => {
    const orchestrator = makeOrchestrator(
      { [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );
    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    // One of one is complete coverage, however thin the market.
    expect(res!.flags).not.toContain('incomplete_pool_coverage');
  });
});

describe('incomplete venue coverage', () => {
  it('will not price a token confidently when a DEX could not be searched', async () => {
    const orchestrator = {
      getAllPools: vi.fn(async (t: string, report?: any) => {
        if (report) { report.adaptersTotal = 5; report.adaptersFailed = 4; }
        return t.toLowerCase() === TOKEN.toLowerCase() ? [TOKEN_USDC_POOL] : [];
      }),
      getAllRawData: vi.fn(async (pools: any[]) =>
        pools.map(p => ({ pool: p, rawData: tokenUsdcRaw }))
      ),
      quoteSell: vi.fn(async () => null),
      getTwapAmountOut: vi.fn(async () => null)
    } as any;

    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    // Every pool the one working adapter found was read, so the read ratio is a
    // perfect 1. The gap is invisible there and has to be reported separately.
    expect(res!.flags).toContain('incomplete_venue_coverage');
    expect(res!.flags).not.toContain('incomplete_pool_coverage');
    expect(res!.confidence).toBeLessThanOrEqual(49);
  });

  it('says nothing when every adapter answered', async () => {
    const orchestrator = makeOrchestrator(
      { [TOKEN.toLowerCase()]: [TOKEN_USDC_POOL] },
      { [TOKEN_USDC_POOL.address]: tokenUsdcRaw }
    );
    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);
    expect(res!.flags).not.toContain('incomplete_venue_coverage');
  });
});

describe('pools blocked on an unavailable anchor', () => {
  it('does not report the survivors as if they were the market', async () => {
    // The token's real depth is its WETH pool; a shallow USDC pool also exists.
    // With no WETH/USD anchor, only the shallow pool can be priced.
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [],
        [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL, TOKEN_USDC_POOL]
      },
      {
        [TOKEN_WETH_POOL.address]: tokenWethRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw
      }
    );

    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);

    // It still answers - the USDC pool is real - but it says the answer is
    // assembled from whatever survived, rather than presenting it as the market.
    expect(res).not.toBeNull();
    expect(res!.flags).toContain('incomplete_quote_coverage');
    expect(res!.confidence).toBeLessThanOrEqual(49);
  });

  it('still throws when the anchor blocked every pool there was', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [], [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL] },
      { [TOKEN_WETH_POOL.address]: tokenWethRaw }
    );

    await expect(
      new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN)
    ).rejects.toMatchObject({ code: 'stale_anchor' });
  });

  it('says nothing when every pool could be converted', async () => {
    const orchestrator = makeOrchestrator(
      {
        [WETH.toLowerCase()]: [WETH_USDC_POOL],
        [TOKEN.toLowerCase()]: [TOKEN_WETH_POOL, TOKEN_USDC_POOL]
      },
      {
        [WETH_USDC_POOL.address]: wethUsdcRaw,
        [TOKEN_WETH_POOL.address]: tokenWethRaw,
        [TOKEN_USDC_POOL.address]: tokenUsdcRaw
      }
    );

    const res = await new PricingEngine(orchestrator, makeRpc(), 'base').calculatePrice(TOKEN);
    expect(res!.flags).not.toContain('incomplete_quote_coverage');
  });
});
