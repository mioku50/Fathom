export function validateEnv(env: any) {
  const requiredVars = [
    'BASE_RPC_URL',
    'X402_NETWORK',
    'X402_PRICE_USDC',
    'FATHOM_X402_RECIPIENT',
    'FATHOM_X402_FACILITATOR_URL',
    'CACHE_DEFAULT_TTL_SECONDS'
  ];

  const missingVars: string[] = [];

  for (const v of requiredVars) {
    if (!env || env[v] === undefined || env[v] === null || env[v] === '') {
      missingVars.push(v);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(`Server configuration error: Missing required environment variables: ${missingVars.join(', ')}`);
  }
}
