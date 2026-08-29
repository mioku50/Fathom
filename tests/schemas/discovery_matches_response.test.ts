import { describe, it, expect, vi } from 'vitest';
import { priceOutputSchema, pricesOutputSchema } from '../../src/schemas/x402DiscoverySchemas';
import { PricingEngine } from '../../src/pricing_engine';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The discovery schema is how an agent decides whether Fathom answers its
 * question at all - Bazaar semantic search reads it before anything is called.
 * Nothing compared it against the real response, so it drifted: `measured_weight`
 * shipped in the payload and stayed absent from the schema, meaning the field
 * that says how much evidence backs a score was invisible to every agent
 * choosing a tool.
 *
 * These tests fail when the two diverge again.
 */

const TOKEN = '0x1111111111111111111111111111111111111111';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const POOL = { address: '0xpool', dex: 'aerodrome', fee: 0.003 };
const RAW = {
  token0: TOKEN,
  token1: USDC,
  reserve0: 1_000_000_000_000_000_000_000n,
  reserve1: 5_000_000_000n,
  updatedAt: 12345
};

async function realResponse() {
  const orchestrator = {
    getAllPools: vi.fn(async (t: string) => (t.toLowerCase() === TOKEN.toLowerCase() ? [POOL] : [])),
    getAllRawData: vi.fn(async (pools: any[]) => pools.map(p => ({ pool: p, rawData: RAW }))),
    quoteSell: vi.fn(async () => null),
    getTwapAmountOut: vi.fn(async () => null)
  } as any;

  const rpc = {
    getTokenDecimals: vi.fn(async (a: string) => (a.toLowerCase() === USDC.toLowerCase() ? 6 : 18)),
    getTokenSymbol: vi.fn(async () => 'TKN')
  } as any;

  const res = await new PricingEngine(orchestrator, rpc, 'base').calculatePrice(TOKEN);
  expect(res).not.toBeNull();
  return res!;
}

describe('discovery schema matches the response it advertises', () => {
  it('declares every field the engine actually returns', async () => {
    const response = await realResponse();
    const declared = Object.keys(priceOutputSchema.properties);

    const undeclared = Object.keys(response).filter(k => !declared.includes(k));
    expect(undeclared).toEqual([]);
  });

  it('does not promise fields the engine never returns', async () => {
    const response = await realResponse();
    const declared = Object.keys(priceOutputSchema.properties);

    // `status` and `error` belong to the batch envelope, not to a single price.
    const batchOnly = ['status', 'error'];
    const missing = declared.filter(k => !(k in response) && !batchOnly.includes(k));
    expect(missing).toEqual([]);
  });

  it('declares the confidence components the model actually has', async () => {
    const response = await realResponse();
    const declared = Object.keys(
      (priceOutputSchema.properties as any).confidence_components.properties
    );

    expect(declared.sort()).toEqual(Object.keys(response.confidence_components).sort());
  });

  it('advertises measured_weight, the field that says what a score rests on', () => {
    const props = priceOutputSchema.properties as any;
    expect(props.measured_weight).toBeDefined();
    expect(props.measured_weight.type).toBe('number');
  });

  it('documents every flag the engine can emit', () => {
    const description = (priceOutputSchema.properties as any).flags.description as string;

    // Every flag pushed anywhere in confidence.ts or pricing_engine.ts. An
    // undocumented flag is a signal an agent cannot act on.
    const emitted = [
      'thin_liquidity',
      'no_exit_liquidity',
      'possible_manipulation',
      'single_pool',
      'stale',
      'unsellable',
      'twap_unavailable',
      'freshness_unchecked',
      'sellability_unchecked',
      'liquidity_unmeasured',
      'low_measurement_coverage',
      'no_measurable_signal',
      'depth_unavailable',
      'incomplete_pool_coverage',
      'incomplete_venue_coverage',
      'exit_liquidity_unverified',
      'hardcoded_numeraire'
    ];

    const undocumented = emitted.filter(f => !description.includes(f));
    expect(undocumented).toEqual([]);
  });

  it('keeps the batch schema in step with the single-token one', () => {
    const single = Object.keys(priceOutputSchema.properties);
    const batchItem = Object.keys(
      (pricesOutputSchema.properties as any).results.items.properties
    );

    const missingFromBatch = single.filter(k => !batchItem.includes(k));
    expect(missingFromBatch).toEqual([]);
  });
});

describe('the assess schema matches the assessment it advertises', () => {
  async function realAssessment() {
    const { assess } = await import('../../src/assess');
    return assess(await realResponse(), 10000);
  }

  it('declares every field the assessment actually returns', async () => {
    const { assessOutputSchema } = await import('../../src/schemas/x402DiscoverySchemas');
    const declared = Object.keys(assessOutputSchema.properties);
    const undeclared = Object.keys(await realAssessment()).filter(k => !declared.includes(k));
    expect(undeclared).toEqual([]);
  });

  it('does not promise fields the assessment never returns', async () => {
    const { assessOutputSchema } = await import('../../src/schemas/x402DiscoverySchemas');
    const assessment = await realAssessment();
    const missing = Object.keys(assessOutputSchema.properties).filter(k => !(k in assessment));
    expect(missing).toEqual([]);
  });

  it('declares the nested exit and price_trust shapes correctly', async () => {
    const { assessOutputSchema } = await import('../../src/schemas/x402DiscoverySchemas');
    const props = assessOutputSchema.properties as any;
    const assessment = await realAssessment();

    expect(Object.keys(props.exit.properties).sort()).toEqual(Object.keys(assessment.exit).sort());
    expect(Object.keys(props.price_trust.properties).sort()).toEqual(
      Object.keys(assessment.price_trust).sort()
    );
  });

  it('advertises exactly the verdicts the code can produce', async () => {
    const { assessOutputSchema } = await import('../../src/schemas/x402DiscoverySchemas');
    const declared = (assessOutputSchema.properties as any).verdict.enum as string[];

    // An agent branching on a verdict we never documented has no case for it.
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'assess.ts'), 'utf8');
    const produced = [...source.matchAll(/verdict: '([a-z]+)'/g)].map(m => m[1]);

    expect([...new Set(produced)].sort()).toEqual([...declared].sort());
  });
});
