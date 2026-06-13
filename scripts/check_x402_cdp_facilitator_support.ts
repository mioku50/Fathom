import { createCdpAuthHeaders } from '@coinbase/x402';
import { HTTPFacilitatorClient } from '@x402/core/server';

async function main() {
  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;

  console.log("Diagnostics:");
  console.log(`- CDP mode detected: ${process.env.FATHOM_X402_FACILITATOR_URL === 'https://api.cdp.coinbase.com/platform/v2/x402' ? 'yes' : 'no'}`);
  console.log(`- CDP_API_KEY_ID present: ${cdpKeyId ? 'yes' : 'no'}`);
  console.log(`- CDP_API_KEY_SECRET present: ${cdpKeySecret ? 'yes' : 'no'}`);
  console.log("");

  if (!cdpKeyId || !cdpKeySecret) {
    console.error("❌ CDP_API_KEY_ID or CDP_API_KEY_SECRET missing in environment");
    process.exit(1);
  }

  console.log("Checking CDP Facilitator support...");
  
  const authHeadersFn = createCdpAuthHeaders(cdpKeyId, cdpKeySecret);
  
  const client = new HTTPFacilitatorClient({
    url: 'https://api.cdp.coinbase.com/platform/v2/x402',
    createAuthHeaders: authHeadersFn as any
  });

  try {
    const supported = await client.getSupported();
    console.log("✅ Successfully fetched supported routes from CDP Facilitator:");
    console.log(JSON.stringify(supported, null, 2));

    const exactEvmSupported = supported.kinds.some((kind: any) => 
      kind.scheme === 'exact' && 
      (kind.network === 'eip155:8453' || kind.network === 'base')
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
