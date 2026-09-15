import { z } from 'zod';
import { Action, ActionProvider, EvmWalletProvider, Network } from '@coinbase/agentkit';
import { createFathomClient } from '../core/client.js';
import { createFathomX402Fetch, EvmSigner } from '../x402/transport.js';

export const FathomAssessActionSchema = z.object({
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Base ERC-20 token contract address (0x...)')
    .describe('The Base ERC-20 token address to assess.'),
  size_usd: z
    .number()
    .min(1)
    .max(10_000_000)
    .optional()
    .describe('Position size to quote on chain in USD (default: 10,000; range: 1..10,000,000).'),
  sizeUsd: z
    .number()
    .min(1)
    .max(10_000_000)
    .optional()
    .describe('Alternative camelCase position size in USD.')
});

export interface FathomActionProviderOptions {
  /**
   * Override the API origin. The payment policy is unaffected: a non-canonical
   * origin is refused by the transport before anything is signed.
   */
  baseUrl?: string;
  /**
   * Lower the per-call spend ceiling below the canonical 1000 atomic units
   * (0.001 USDC). It cannot be raised, and the recipient, asset, network and
   * endpoint are not settable at all.
   */
  maxAmountAtomic?: bigint;
}

/**
 * AgentKit Action Provider for Fathom.
 *
 * Flow: wallet provider → signer → shared transport → shared client → client.assess().
 * Base mainnet only. Never executes a swap.
 */
export class FathomActionProvider extends ActionProvider<EvmWalletProvider> {
  private readonly options?: FathomActionProviderOptions;

  constructor(options?: FathomActionProviderOptions) {
    super('fathom', []);
    this.options = options;
  }

  supportsNetwork(network: Network): boolean {
    const chainId = String(network.chainId ?? '');
    const netId = String(network.networkId ?? '').toLowerCase();
    return chainId === '8453' || netId === 'base-mainnet' || netId === 'base';
  }

  getActions(walletProvider: EvmWalletProvider): Action[] {
    return [
      {
        name: 'fathom_assess',
        description:
          'Assess whether a Base ERC-20 token position can be exited. Quotes the exact position size on chain across DEXes and returns a branchable verdict: tradeable, caution, illiquid, or unverified. Base mainnet only. Never executes a swap.',
        schema: FathomAssessActionSchema,
        invoke: async (args: z.infer<typeof FathomAssessActionSchema>) => {
          const network = walletProvider.getNetwork();
          if (!this.supportsNetwork(network)) {
            throw new Error(
              `Fathom is only supported on Base mainnet (chainId: 8453). Current network: ${network.networkId || network.chainId}`
            );
          }

          const signer: EvmSigner = {
            address: walletProvider.getAddress(),
            signTypedData: async (params: any) => {
              return await walletProvider.signTypedData(params);
            }
          };

          const paidFetch = createFathomX402Fetch({
            signer,
            ...(this.options?.maxAmountAtomic !== undefined
              ? { maxAmountAtomic: this.options.maxAmountAtomic }
              : {})
          });

          const client = createFathomClient({
            fetch: paidFetch,
            baseUrl: this.options?.baseUrl
          });

          const sizeUsd = args.size_usd ?? args.sizeUsd ?? 10000;
          const assessment = await client.assess({
            token: args.token,
            sizeUsd,
            chain: 'base'
          });

          return JSON.stringify(assessment);
        }
      }
    ];
  }
}

export function fathomActionProvider(options?: FathomActionProviderOptions): FathomActionProvider {
  return new FathomActionProvider(options);
}
