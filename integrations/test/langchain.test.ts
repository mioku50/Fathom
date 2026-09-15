import { describe, it, expect, vi } from 'vitest';
import {
  createFathomAssessTool,
  FathomToolInputSchema
} from '../src/langchain/fathomTool.js';
import { FathomClient } from '../src/core/types.js';

const VALID_TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

const mockAssessment = {
  token: VALID_TOKEN,
  chain: 'base',
  symbol: 'AERO',
  price_usd: 0.484,
  verdict: 'tradeable' as const,
  reason: '$10,000 fills cleanly.',
  size_usd: 10000,
  exit: {
    fillable: true,
    proceeds_usd: 9952,
    price_impact_bps: 48,
    execution_price_usd: 0.4818
  },
  price_trust: {
    confidence: 96,
    measured_weight: 0.75,
    sources: 6,
    dispersion_bps: 40,
    twap_deviation_bps: 0.9
  },
  concerns: [],
  unverified: [],
  updated_at: '2026-08-29T10:00:00.000Z'
};

describe('LangChain Adapter: createFathomAssessTool', () => {
  it('has tool name fathom_assess and valid schema', () => {
    const mockClient: FathomClient = {
      assess: vi.fn()
    };
    const tool = createFathomAssessTool({ client: mockClient });

    expect(tool.name).toBe('fathom_assess');
    expect(tool.description).toContain('Base');
    expect(tool.schema).toBe(FathomToolInputSchema);
  });

  it('validates tool schema correctly', () => {
    const valid = FathomToolInputSchema.safeParse({
      token: VALID_TOKEN,
      size_usd: 5000,
      chain: 'base'
    });
    expect(valid.success).toBe(true);

    const invalid = FathomToolInputSchema.safeParse({
      token: 'bad-token'
    });
    expect(invalid.success).toBe(false);
  });

  it('calls core client.assess exactly once and returns JSON string', async () => {
    const mockAssess = vi.fn().mockResolvedValue(mockAssessment);
    const mockClient: FathomClient = {
      assess: mockAssess
    };

    const tool = createFathomAssessTool({ client: mockClient });
    const resultStr = await tool.invoke({
      token: VALID_TOKEN,
      size_usd: 10000
    });

    expect(mockAssess).toHaveBeenCalledTimes(1);
    expect(mockAssess).toHaveBeenCalledWith({
      token: VALID_TOKEN,
      sizeUsd: 10000,
      chain: 'base'
    });

    const parsed = JSON.parse(resultStr);
    expect(parsed.verdict).toBe('tradeable');
    expect(parsed.token).toBe(VALID_TOKEN);
  });
});
