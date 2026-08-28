import { describe, it, expect, vi } from 'vitest';
import { PricingEngine } from '../../src/pricing_engine';
import { PricingError } from '../../src/errors';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TOKEN = '0x1111111111111111111111111111111111111111';

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

function makeOrchestrator(poolsByToken: Record<string, any[]>, rawByPool: Record<string, any>) {
  return {
    getAllPools: vi.fn(async (token: string) => poolsByToken[token.toLowerCase()] ?? []),
    getAllRawData: vi.fn(async (pools: any[]) =>
      pools
        .filter(p => rawByPool[p.address])
        .map(p => ({ pool: p, rawData: rawByPool[p.address] }))
    )
  } as any;
}

function makeRpc(overrides: Record<string, unknown> = {}) {
  return {
    getTokenDecimals: vi.fn(async (address: string) =>
      address.toLowerCase() === USDC.toLowerCase() ? 6 : 18
    ),
    ...overrides
  } as any;
}

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

  it('refuses to invent depth for a concentrated-liquidity main pool', async () => {
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

  it('refuses to apply x*y=k to an Aerodrome stable pool', async () => {
    const orchestrator = makeOrchestrator(
      { [WETH.toLowerCase()]: [WETH_USDC_POOL], [TOKEN.toLowerCase()]: [TOKEN_USDC_STABLE_POOL] },
      { [WETH_USDC_POOL.address]: wethUsdcRaw, [TOKEN_USDC_STABLE_POOL.address]: tokenUsdcRaw }
    );

    const engine = new PricingEngine(orchestrator, makeRpc(), 'base');
    const res = await engine.calculatePrice(TOKEN);

    expect(res).not.toBeNull();
    // reserves are present, but the curve is x3y+y3x - constant product would lie
    expect(res!.depth_1pct_usd).toBeNull();
    expect(res!.flags).toContain('depth_unavailable');
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
});
