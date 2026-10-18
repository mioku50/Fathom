// Read-only checks: no payment, signing, or catalog registration is performed.
const { decodePaymentRequiredHeader } = require('@x402/core/http');
const { validateDiscoveryExtension } = require('@x402/extensions/bazaar');

const origin = 'https://fathom-api.mioku-fathom.workers.dev';
const resource = `${origin}/v1/assess`;
const facilitator = 'https://api.cdp.coinbase.com/platform/v2/x402';

async function getJSON(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Discovery API returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const response = await fetch(resource, { signal: AbortSignal.timeout(30000) });
  const header = response.headers.get('PAYMENT-REQUIRED');
  if (response.status !== 402 || !header) throw new Error('Assess did not return an x402 challenge');
  const challenge = decodePaymentRequiredHeader(header);
  if (challenge.resource?.url !== resource) throw new Error('Challenge resource is not the canonical assess URL');
  if (!challenge.resource.description || challenge.resource.description.length > 500) {
    throw new Error('Description must contain 1–500 characters for CDP');
  }
  const bazaar = challenge.extensions?.bazaar;
  if (!bazaar || !validateDiscoveryExtension(bazaar).valid) throw new Error('Invalid Bazaar extension');
  const payTo = challenge.accepts.find(option => option.network === 'eip155:8453')?.payTo;
  if (!payTo) throw new Error('No Base mainnet payment option');

  const validation = await getJSON(`${facilitator}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource, method: 'GET' })
  });
  if (!validation.valid || validation.simulation?.outcome !== 'accepted') {
    throw new Error(`CDP validation failed: ${JSON.stringify(validation.preflight?.filter(check => !check.passed))}`);
  }

  // The general resource-list API does not filter by payTo; use the dedicated
  // merchant API and match the hostname because this wallet serves other apps.
  const resources = [];
  let offset = 0;
  for (;;) {
    const query = new URLSearchParams({ payTo, limit: '100', offset: String(offset) });
    const page = await getJSON(`${facilitator}/discovery/merchant?${query}`);
    if (!Array.isArray(page.resources)) throw new Error('Invalid merchant discovery response');
    resources.push(...page.resources);
    offset += page.resources.length;
    if (offset >= page.pagination?.total) break;
    if (!page.resources.length) throw new Error('Merchant pagination ended before the reported total');
  }
  const entries = resources.filter(entry => {
    try { return new URL(entry.resource).origin === origin; } catch { return false; }
  });
  const indexed = entries.some(entry => entry.resource === resource);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    resource,
    serviceName: challenge.resource.serviceName,
    descriptionLength: challenge.resource.description.length,
    validator: validation.simulation.outcome,
    indexed,
    entries: entries.map(entry => ({
      resource: entry.resource,
      lastUpdated: entry.lastUpdated,
      serviceName: entry.serviceName,
      quality: entry.quality
    }))
  }, null, 2));
  if (!indexed) {
    console.error('Assess is not indexed. CDP indexes after a successful settlement and may take up to 15 minutes. Resources expire after 30 days without settlement.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
