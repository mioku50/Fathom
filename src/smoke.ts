import { DEXOrchestrator, type CacheLayer } from './orchestrator';
import { PricingEngine } from './pricing_engine';
import { PriceRpcClient } from './utils/price_rpc';
import { isPricingError } from './errors';

/**
 * Scheduled self-check.
 *
 * Fathom's failure mode is quiet: an RPC provider changes behaviour, a factory
 * moves, a quoter starts reverting, and the API keeps returning 200 with a
 * thinner answer than before. Uptime checks do not catch that. These probes
 * assert the things a caller actually depends on, on real mainnet state.
 */

export type SmokeCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type SmokeResult = {
  ok: boolean;
  ran_at: string;
  duration_ms: number;
  checks: SmokeCheck[];
};

const WETH = '0x4200000000000000000000000000000000000006';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

export const SMOKE_KV_KEY = 'smoke:last';

/**
 * Bounds wide enough not to page anyone over ordinary volatility, tight enough
 * that a decimals or anchor bug - the failures that actually happened here -
 * cannot slip through.
 */
const WETH_USD_RANGE: [number, number] = [200, 20000];

export async function runSmokeChecks(
  buildEngine: () => PricingEngine
): Promise<SmokeResult> {
  const started = Date.now();
  const checks: SmokeCheck[] = [];

  const record = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
  };

  const engine = buildEngine();

  // WETH: the anchor everything else is priced through.
  try {
    const weth = await engine.calculatePrice(WETH);
    if (!weth) {
      record('weth_priced', false, 'no price returned');
    } else {
      const inRange = weth.price_usd >= WETH_USD_RANGE[0] && weth.price_usd <= WETH_USD_RANGE[1];
      record('weth_priced', inRange, `price_usd=${weth.price_usd}`);
      record('weth_multi_source', weth.source_count >= 2, `source_count=${weth.source_count}`);
      record(
        'weth_depth_quoted',
        weth.sell_quotes.some(q => q.proceeds_usd !== null),
        `sell_quotes=${weth.sell_quotes.map(q => q.proceeds_usd === null ? 'null' : q.proceeds_usd.toFixed(0)).join('/')}`
      );
      record('weth_twap', weth.twap.price_usd !== null, `twap=${weth.twap.price_usd ?? 'null'}`);
    }
  } catch (error: any) {
    record('weth_priced', false, isPricingError(error) ? error.code : `error: ${error?.message}`);
  }

  // AERO: exercises Aerodrome and Slipstream discovery specifically.
  try {
    const aero = await engine.calculatePrice(AERO);
    if (!aero) {
      record('aero_priced', false, 'no price returned');
    } else {
      record('aero_priced', aero.price_usd > 0, `price_usd=${aero.price_usd}`);
      record('aero_multi_source', aero.source_count >= 2, `source_count=${aero.source_count}`);
    }
  } catch (error: any) {
    record('aero_priced', false, isPricingError(error) ? error.code : `error: ${error?.message}`);
  }

  return {
    ok: checks.every(c => c.ok),
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    checks
  };
}
