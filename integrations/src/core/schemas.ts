import { z } from 'zod';

export const VerdictSchema = z.enum(['tradeable', 'caution', 'illiquid', 'unverified']);

export const ExitSchema = z.object({
  fillable: z.boolean().nullable(),
  proceeds_usd: z.number().nullable(),
  price_impact_bps: z.number().nullable(),
  execution_price_usd: z.number().nullable()
});

export const PriceTrustSchema = z.object({
  confidence: z.number(),
  measured_weight: z.number(),
  sources: z.number(),
  dispersion_bps: z.number().nullable(),
  twap_deviation_bps: z.number().nullable()
});

/**
 * Canonical Zod schema for Fathom Assessment responses.
 *
 * NOTE (Finding 1): `symbol` and `price_usd` MUST be optional because Fathom returns
 * an unverified assessment (`UnverifiedAssessment = Omit<Assessment, 'symbol' | 'price_usd'>`)
 * when a token price could not be established.
 */
export const FathomAssessmentSchema = z.object({
  token: z.string(),
  chain: z.string(),
  symbol: z.string().optional(),
  price_usd: z.number().optional(),
  verdict: VerdictSchema,
  reason: z.string(),
  size_usd: z.number(),
  exit: ExitSchema,
  price_trust: PriceTrustSchema,
  concerns: z.array(z.string()),
  unverified: z.array(z.string()),
  updated_at: z.string()
});

export const AssessInputSchema = z.object({
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Token must be a valid 20-byte hex EVM address (0x...)'),
  sizeUsd: z
    .number()
    .min(1, 'sizeUsd must be at least 1')
    .max(10_000_000, 'sizeUsd cannot exceed 10,000,000')
    .default(10000)
    .optional(),
  chain: z
    .literal('base', {
      errorMap: () => ({ message: "Only 'base' is accepted as chain" })
    })
    .default('base')
    .optional()
});
