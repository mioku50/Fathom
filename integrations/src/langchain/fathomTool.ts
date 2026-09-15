import { tool, StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FathomClient } from '../core/types.js';

export const FathomToolInputSchema = z.object({
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Base ERC-20 token address (0x...)')
    .describe('Base ERC-20 token address'),
  size_usd: z
    .number()
    .min(1)
    .max(10_000_000)
    .optional()
    .describe('Position size to quote on chain in USD (default: 10,000; range: 1..10,000,000)'),
  sizeUsd: z
    .number()
    .min(1)
    .max(10_000_000)
    .optional()
    .describe('Alternative camelCase position size in USD'),
  chain: z
    .literal('base')
    .default('base')
    .optional()
    .describe('Target chain (only base supported)')
});

export type FathomToolInput = z.infer<typeof FathomToolInputSchema>;

export interface CreateFathomAssessToolOptions {
  client: FathomClient;
  description?: string;
}

/**
 * Creates a LangChain structured tool for Fathom assessment.
 *
 * Calls client.assess(input) directly — contains no HTTP or x402 transport logic.
 */
export function createFathomAssessTool(options: CreateFathomAssessToolOptions): StructuredTool {
  const { client, description } = options;

  return tool(
    async (input: FathomToolInput) => {
      const sizeUsd = input.size_usd ?? input.sizeUsd;
      const result = await client.assess({
        token: input.token,
        ...(sizeUsd !== undefined ? { sizeUsd } : {}),
        chain: input.chain ?? 'base'
      });
      return JSON.stringify(result);
    },
    {
      name: 'fathom_assess',
      description:
        description ??
        'Assess whether a Base ERC-20 token position can be exited. Quotes the exact position size on chain across five DEXes and returns a single branchable verdict: tradeable, caution, illiquid, or unverified.',
      schema: FathomToolInputSchema
    } as any
  );
}
