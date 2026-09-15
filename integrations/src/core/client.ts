import {
  AssessInputSchema,
  FathomAssessmentSchema
} from './schemas.js';
import {
  AssessInput,
  CreateFathomClientOptions,
  FathomAssessment,
  FathomClient
} from './types.js';
import {
  FathomApiError,
  FathomNetworkError,
  FathomPaymentPolicyError,
  FathomPaymentRequiredError,
  FathomServiceUnavailableError,
  FathomValidationError
} from './errors.js';

const DEFAULT_BASE_URL = 'https://fathom-api.mioku-fathom.workers.dev';

export function createFathomClient(options?: CreateFathomClientOptions): FathomClient {
  const fetchFn = options?.fetch ?? globalThis.fetch;
  const rawBaseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  return {
    async assess(input: AssessInput): Promise<FathomAssessment> {
      // 1. Input validation
      const parseResult = AssessInputSchema.safeParse(input);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        throw new FathomValidationError(
          firstIssue?.message || 'Invalid assessment input',
          parseResult.error.issues
        );
      }
      const validated = parseResult.data;

      // 2. URL construction
      const url = new URL(`${baseUrl}/v1/assess`);
      url.searchParams.set('token', validated.token);
      url.searchParams.set('size_usd', String(validated.sizeUsd ?? 10000));
      url.searchParams.set('chain', validated.chain ?? 'base');

      // 3. HTTP fetch
      let response: Response;
      try {
        response = await fetchFn(url.toString(), {
          headers: {
            Accept: 'application/json'
          }
        });
      } catch (err: any) {
        // A fail-closed payment refusal is a policy decision, not a network problem.
        // Collapsing the two would tell a caller to retry something it must not retry.
        if (err instanceof FathomPaymentPolicyError) throw err;
        throw new FathomNetworkError(err?.message || 'Failed to fetch from Fathom API', err);
      }

      // 4. Response parsing & status handling
      const responseText = await response.text();
      let responseBody: any = null;
      if (responseText) {
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = responseText;
        }
      }

      if (response.status === 402) {
        throw new FathomPaymentRequiredError(
          'Payment required for /v1/assess',
          responseBody
        );
      }

      if (response.status === 503) {
        // Live server returns 503 with an unverifiedAssessment payload when price cannot be established,
        // specifically to prevent x402 settlement while delivering a branchable answer.
        // If the body conforms to FathomAssessment (with verdict 'unverified'), return it.
        if (responseBody && typeof responseBody === 'object' && responseBody.verdict === 'unverified') {
          const reducedParse = FathomAssessmentSchema.safeParse(responseBody);
          if (reducedParse.success) {
            return reducedParse.data;
          }
        }
        const errorMsg = typeof responseBody === 'object' && responseBody?.message
          ? responseBody.message
          : typeof responseBody === 'object' && responseBody?.error
          ? responseBody.error
          : 'Fathom service unavailable';
        throw new FathomServiceUnavailableError(errorMsg, responseBody);
      }

      if (!response.ok) {
        const errorMsg = typeof responseBody === 'object' && (responseBody?.message || responseBody?.error)
          ? responseBody.message || responseBody.error
          : response.statusText || 'Unexpected error';
        throw new FathomApiError(response.status, errorMsg, responseBody);
      }

      const parsedResponse = FathomAssessmentSchema.safeParse(responseBody);
      if (!parsedResponse.success) {
        throw new FathomValidationError(
          'API response did not match expected FathomAssessment schema',
          parsedResponse.error.issues
        );
      }

      return parsedResponse.data;
    }
  };
}
