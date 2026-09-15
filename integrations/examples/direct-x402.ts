import { privateKeyToAccount } from 'viem/accounts';
import { createFathomClient, createFathomX402Fetch, EvmSigner } from '../src/index.js';

async function main() {
  const privateKey = process.env.FATHOM_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    throw new Error('Please set FATHOM_PRIVATE_KEY environment variable');
  }

  const account = privateKeyToAccount(privateKey);
  const signer: EvmSigner = {
    address: account.address,
    signTypedData: async params => {
      return account.signTypedData(params as any);
    }
  };

  const paidFetch = createFathomX402Fetch({ signer });
  const client = createFathomClient({ fetch: paidFetch });

  // Assess a $10,000 exit for AERO on Base mainnet
  const assessment = await client.assess({
    token: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    sizeUsd: 10000,
    chain: 'base'
  });

  console.log('Verdict:', assessment.verdict);
  console.log('Reason:', assessment.reason);
  console.log('Fillable:', assessment.exit.fillable);
  console.log('Price impact (bps):', assessment.exit.price_impact_bps);
}

if (require.main === module) {
  main().catch(console.error);
}
