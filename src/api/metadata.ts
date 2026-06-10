import { createPublicClient, http, Address, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)"
]);

export type TokenMetadata = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
};

export async function getTokenMetadata(tokenAddress: Address, rpcUrl?: string, network?: string): Promise<TokenMetadata> {
  const client = createPublicClient({
    chain: network === 'base-sepolia' ? baseSepolia : base,
    transport: http(rpcUrl)
  });

  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'symbol'
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'name'
      }),
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals'
      })
    ]);

    return {
      address: tokenAddress,
      symbol,
      name,
      decimals
    };
  } catch (error) {
    const errorContext = `[network: ${network || 'base'}, rpc: ${rpcUrl ? 'provided' : 'default'}]`;
    console.error(`Error fetching metadata for ${tokenAddress} ${errorContext}:`, error);
    throw new Error(`Failed to fetch token metadata for ${tokenAddress} ${errorContext}`);
  }
}

export async function getBatchTokenMetadata(tokens: Address[], rpcUrl?: string, network?: string): Promise<TokenMetadata[]> {
  try {
    return await Promise.all(tokens.map(token => getTokenMetadata(token, rpcUrl, network)));
  } catch (error) {
    const errorContext = `[network: ${network || 'base'}, rpc: ${rpcUrl ? 'provided' : 'default'}]`;
    console.error(`Error fetching batch metadata ${errorContext}:`, error);
    throw new Error(`Failed to fetch batch token metadata ${errorContext}`);
  }
}
