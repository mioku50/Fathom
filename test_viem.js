const { createWalletClient, http } = require('viem');
const { baseSepolia } = require('viem/chains');

async function test() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  console.log("Creating client for", rpcUrl);
  const client = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl) });
  console.log("Fetching chain ID...");
  const chainId = await client.getChainId();
  console.log("Chain ID:", chainId);
}
test().catch(console.error);
