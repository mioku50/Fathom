import { AgentKit, ViemWalletProvider } from '@coinbase/agentkit';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { fathomActionProvider } from '../src/index.js';

async function main() {
  const privateKey = process.env.FATHOM_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    throw new Error('Please set FATHOM_PRIVATE_KEY environment variable');
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http()
  });

  const walletProvider = new ViemWalletProvider(walletClient as any);
  const agentKit = await AgentKit.from({
    walletProvider,
    actionProviders: [fathomActionProvider()]
  });

  const actions = agentKit.getActions();
  console.log(
    'Registered actions:',
    actions.map(a => a.name)
  );
}

if (require.main === module) {
  main().catch(console.error);
}
