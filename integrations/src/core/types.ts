import { z } from 'zod';
import {
  FathomAssessmentSchema,
  VerdictSchema,
  AssessInputSchema,
  ExitSchema,
  PriceTrustSchema
} from './schemas.js';

export type FathomAssessment = z.infer<typeof FathomAssessmentSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type ExitInfo = z.infer<typeof ExitSchema>;
export type PriceTrustInfo = z.infer<typeof PriceTrustSchema>;
export type AssessInput = z.input<typeof AssessInputSchema>;

export interface FathomClient {
  assess(input: AssessInput): Promise<FathomAssessment>;
}

export interface CreateFathomClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}
