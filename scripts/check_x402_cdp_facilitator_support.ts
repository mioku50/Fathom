import { createCdpAuthHeaders } from '@coinbase/x402';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { config } from 'dotenv';
config();

async function main() {
  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;

  if (!cdpKeyId || !cdpKeySecret) {
    console.error("❌ CDP_API_KEY_ID or CDP_API_KEY_SECRET missing in environment");
    process.exit(1);
  }

  console.log("Checking CDP Facilitator support...");
  
  const authHeadersMap = createCdpAuthHeaders(cdpKeyId, cdpKeySecret);
  
  const client = new HTTPFacilitatorClient({
    url: 'https://api.cdp.coinbase.com/platform/v2/x402',
    createAuthHeaders: async () => authHeadersMap
  });

  try {
    const supported = await client.getSupported();
    console.log("✅ Successfully fetched supported routes from CDP Facilitator:");
    console.log(JSON.stringify(supported, null, 2));

    const exactEvmSupported = supported.accepts.some((accept: any) => 
      accept.scheme === 'exact' && 
      (accept.network === 'eip155:8453' || accept.network === 'base')
    );

    if (exactEvmSupported) {
      console.log("\n✅ CDP Facilitator SUPPORTS 'exact' scheme on Base mainnet ('eip155:8453')");
    } else {
      console.log("\n❌ CDP Facilitator DOES NOT SHOW support for 'exact' scheme on Base mainnet");
    }
  } catch (err) {
    console.error("❌ Failed to contact CDP Facilitator:");
    console.error(err);
    process.exit(1);
  }
}

main();
