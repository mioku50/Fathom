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
  /**
   * @param deterministic True when repeating the call cannot change the answer,
   *   so callers know not to retry - an out-of-range decimals value, say, as
   *   opposed to a throttled request.
   */
  constructor(
    public readonly code: PricingErrorCode,
    message: string,
    public readonly deterministic: boolean = false
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

export function isPricingError(error: unknown): error is PricingError {
  return error instanceof PricingError;
}
