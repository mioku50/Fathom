#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { createFathomClient } from '../src/core/client.js';
import { createFathomX402Fetch, EvmSigner } from '../src/x402/transport.js';

function printHelp(): void {
  console.log(`
fathom-assess - Assess whether a Base ERC-20 token position can be exited

USAGE:
  fathom-assess --token <address> [--size-usd <amount>] [--chain <chain>]

OPTIONS:
  --token <0x...>     Base ERC-20 token address (required)
  --size-usd <num>    Position size in USD (optional, default: 10000, range: 1..10000000)
  --chain <chain>     Target chain (optional, default: base)
  --help, -h          Show this help message

AUTHENTICATION:
  Private key must be set in FATHOM_PRIVATE_KEY or PRIVATE_KEY environment variable.
  NEVER pass a private key via command line arguments.
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = [...argv];

  // Disallow passing private key as an argument for security
  for (const arg of args) {
    if (
      arg.startsWith('--private-key') ||
      arg.startsWith('--key') ||
      arg === '-k' ||
      arg.startsWith('-k=')
    ) {
      console.error(
        'Security Error: Private keys must NEVER be passed as CLI arguments. Use FATHOM_PRIVATE_KEY or PRIVATE_KEY environment variable.'
      );
      process.exit(1);
    }
  }

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    return;
  }

  let token: string | undefined;
  let sizeUsd: number | undefined;
  let chain: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--token' && i + 1 < args.length) {
      token = args[++i];
    } else if (arg.startsWith('--token=')) {
      token = arg.slice('--token='.length);
    } else if (arg === '--size-usd' && i + 1 < args.length) {
      sizeUsd = Number(args[++i]);
    } else if (arg.startsWith('--size-usd=')) {
      sizeUsd = Number(arg.slice('--size-usd='.length));
    } else if (arg === '--chain' && i + 1 < args.length) {
      chain = args[++i];
    } else if (arg.startsWith('--chain=')) {
      chain = arg.slice('--chain='.length);
    }
  }

  if (!token) {
    console.error('Error: --token <0x...> is required.');
    process.exit(1);
  }

  const rawKey = process.env.FATHOM_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!rawKey) {
    console.error(
      'Error: Private key required. Set FATHOM_PRIVATE_KEY or PRIVATE_KEY environment variable.'
    );
    process.exit(1);
  }

  const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;

  let signer: EvmSigner;
  try {
    const account = privateKeyToAccount(hexKey);
    signer = {
      address: account.address,
      signTypedData: async params => {
        return account.signTypedData(params as any);
      }
    };
  } catch {
    console.error('Error: Invalid private key in environment variable.');
    process.exit(1);
  }

  const paidFetch = createFathomX402Fetch({ signer });
  const client = createFathomClient({ fetch: paidFetch });

  try {
    const assessment = await client.assess({
      token,
      ...(sizeUsd !== undefined ? { sizeUsd } : {}),
      ...(chain ? { chain: chain as any } : {})
    });
    console.log(JSON.stringify(assessment, null, 2));
  } catch (err: any) {
    console.error(`Assessment failed: ${err?.message || err}`);
    process.exit(1);
  }
}

/**
 * True only when this file is the process entry point.
 *
 * `require.main === module` does not exist in ESM. Comparing real paths rather
 * than the raw argv keeps this correct when the bin is reached through a symlink,
 * which is how npm installs it.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch(err => {
    console.error(`Unexpected error: ${err?.message || err}`);
    process.exit(1);
  });
}
