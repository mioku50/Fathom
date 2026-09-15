/**
 * Base error class for all Fathom integration errors.
 */
export class FathomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FathomError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when input arguments fail validation or when API response schema fails validation.
 */
export class FathomValidationError extends FathomError {
  public readonly issues?: unknown;

  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = 'FathomValidationError';
    this.issues = issues;
  }
}

/**
 * Thrown when an endpoint requires x402 payment (HTTP 402) and no valid payment was made.
 */
export class FathomPaymentRequiredError extends FathomError {
  public readonly status = 402;
  public readonly paymentRequired?: unknown;

  constructor(message: string, paymentRequired?: unknown) {
    super(message);
    this.name = 'FathomPaymentRequiredError';
    this.paymentRequired = paymentRequired;
  }
}

/**
 * Thrown when Fathom service is unavailable (HTTP 503), e.g. upstream RPC failure.
 */
export class FathomServiceUnavailableError extends FathomError {
  public readonly status = 503;
  public readonly responseBody?: unknown;

  constructor(message: string, responseBody?: unknown) {
    super(message);
    this.name = 'FathomServiceUnavailableError';
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when a low-level network or fetch error occurs.
 */
export class FathomNetworkError extends FathomError {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FathomNetworkError';
    this.cause = cause;
  }
}

/**
 * Thrown when the Fathom API returns an unexpected non-2xx status code.
 */
export class FathomApiError extends FathomError {
  public readonly status: number;
  public readonly responseBody?: unknown;

  constructor(status: number, message: string, responseBody?: unknown) {
    super(`Fathom API error (${status}): ${message}`);
    this.name = 'FathomApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when a request target, or a 402 challenge, fails the fail-closed payment policy.
 *
 * Raised before any typed data is signed. Its existence means no payment was authorised.
 */
export class FathomPaymentPolicyError extends FathomError {
  public readonly detail?: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'FathomPaymentPolicyError';
    this.detail = detail;
  }
}
