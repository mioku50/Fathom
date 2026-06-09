import { createPublicClient, http, Address, parseAbi } from 'viem';
import { base } from 'viem/chains';

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

export async function getTokenMetadata(tokenAddress: Address, rpcUrl?: string): Promise<TokenMetadata> {
  const client = createPublicClient({
    chain: base,
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
    console.error(`Error fetching metadata for ${tokenAddress}:`, error);
    throw new Error(`Failed to fetch token metadata for ${tokenAddress}`);
  }
}

export async function getBatchTokenMetadata(tokens: Address[], rpcUrl?: string): Promise<TokenMetadata[]> {
  try {
    return await Promise.all(tokens.map(token => getTokenMetadata(token, rpcUrl)));
  } catch (error) {
    console.error('Error fetching batch metadata:', error);
    throw new Error('Failed to fetch batch token metadata');
  }
}
