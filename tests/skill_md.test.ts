import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SKILL.md tells an agent when to reach for Fathom and how to read the answer.
 * If it names fields the API does not return, it is worse than absent: the
 * agent writes code against a shape that never arrives.
 */
const skill = readFileSync(join(__dirname, '..', 'SKILL.md'), 'utf8');

describe('SKILL.md', () => {
  it('names the field that says what a confidence score rests on', () => {
    expect(skill).toContain('measured_weight');
    // An earlier draft called it confidence_coverage, which does not exist.
    expect(skill).not.toContain('confidence_coverage');
  });

  it('only references fields the response actually has', async () => {
    const { priceOutputSchema } = await import('../src/schemas/x402DiscoverySchemas');
    const real = Object.keys(priceOutputSchema.properties);

    // Anything written as a bare `snake_case` code span should be a real field
    // or a real flag, not something invented for the documentation.
    const flags = [
      'thin_liquidity', 'no_exit_liquidity', 'possible_manipulation', 'single_pool',
      'stale', 'unsellable', 'twap_unavailable', 'freshness_unchecked',
      'sellability_unchecked', 'depth_unavailable', 'liquidity_unmeasured',
      'low_measurement_coverage', 'no_measurable_signal', 'incomplete_pool_coverage',
      'exit_liquidity_unverified', 'hardcoded_numeraire'
    ];
    const errors = ['rpc_error', 'stale_anchor', 'unknown_decimals', 'not_found'];
    const quoteFields = ['size_usd', 'proceeds_usd', 'execution_price_usd', 'price_impact_bps'];
    const known = new Set([...real, ...flags, ...errors, ...quoteFields]);

    const referenced = [...skill.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map(m => m[1]);
    const unknown = [...new Set(referenced)].filter(f => !known.has(f));

    expect(unknown).toEqual([]);
  });

  it('separates flags that judge the token from flags that judge the reading', () => {
    // Confusing the two makes an agent reject good tokens for our RPC failures.
    expect(skill).toContain('Never conclude a token is bad from the second kind');
    expect(skill).toContain('exit_liquidity_unverified');
  });

  it('states what is not measured rather than leaving it implied', () => {
    expect(skill).toMatch(/does not do/i);
    expect(skill).toContain('sellability_unchecked');
    expect(skill).toContain('maturity');
  });

  it('advertises only the chain the service actually reads', () => {
    expect(skill).toContain('Base mainnet');
    expect(skill).not.toMatch(/\bEthereum mainnet\b/);
  });
});

describe('SKILL.md is served', () => {
  it('is reachable without payment, and byte-identical to the repository file', async () => {
    const { app } = await import('../src/index');
    const res = await app.fetch(new Request('https://fathom.test/SKILL.md'), {} as any);

    // A capability description an agent must pay to read is one it never reads.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toBe(skill);
  });
});
