import { privateKeyToAccount } from 'viem/accounts';
import {
  createFathomClient,
  createFathomX402Fetch,
  createFathomAssessTool,
  EvmSigner
} from '../src/index.js';

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
  const tool = createFathomAssessTool({ client });

  console.log('Tool registered:', tool.name);
  console.log('Description:', tool.description);
}

if (require.main === module) {
  main().catch(console.error);
}
