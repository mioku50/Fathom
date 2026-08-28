/**
 * Typed pricing failures.
 *
 * Fathom is an oracle: refusing to answer is always better than answering
 * confidently with a value we cannot stand behind. These codes mark the cases
 * where an input we depend on could not be established, so the caller gets an
 * explicit failure instead of a silently defaulted price.
 */
export type PricingErrorCode = 'stale_anchor' | 'unknown_decimals';

export class PricingError extends Error {
  constructor(public readonly code: PricingErrorCode, message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

export function isPricingError(error: unknown): error is PricingError {
  return error instanceof PricingError;
}
