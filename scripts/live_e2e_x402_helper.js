const { wrapFetchWithPayment, x402Client } = require('@x402/fetch');
const { registerExactEvmScheme } = require('@x402/evm/exact/client');
const { toClientEvmSigner } = require('@x402/evm');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { baseSepolia, base } = require('viem/chains');

const PRIVATE_KEY = process.env.FATHOM_TEST_WALLET_PRIVATE_KEY;
const URL = process.env.FATHOM_LIVE_URL;
const TOKEN = process.env.FATHOM_TEST_TOKEN;
const ENDPOINT = process.argv[2] || 'metadata';

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Missing FATHOM_TEST_WALLET_PRIVATE_KEY");
    process.exit(1);
  }

  const network = (process.env.X402_NETWORK || "base-sepolia").trim();

  const isBaseMainnet = network === "base" || network === "eip155:8453";
  const isBaseSepolia = network === "base-sepolia" || network === "eip155:84532";

  if (!isBaseMainnet && !isBaseSepolia) {
    console.error(`Unsupported X402_NETWORK: ${network}`);
    process.exit(1);
  }

  const chain = isBaseMainnet ? base : baseSepolia;
  const rpcUrl = isBaseMainnet 
    ? (process.env.BASE_RPC_URL || process.env.BASE_MAINNET_RPC_URL) 
    : (process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL);

  if (!rpcUrl) {
    console.error(`Missing RPC URL for ${network}. Expected ${isBaseMainnet ? "BASE_RPC_URL or BASE_MAINNET_RPC_URL" : "BASE_SEPOLIA_RPC_URL or BASE_RPC_URL"}`);
    process.exit(1);
  }

  console.error(`DEBUG: Helper starting | endpoint: ${ENDPOINT} | network: ${isBaseMainnet ? 'base' : 'baseSepolia'} (${network}) | rpc exists: ${!!rpcUrl}`);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  });

  const paymentClient = new x402Client();
  registerExactEvmScheme(paymentClient, {
      signer: {
        address: client.account.address,
        signTypedData: async (params) => client.signTypedData({ account: client.account, ...params })
      },
  });
  
  const myFetch = (url, init) => fetch(url, init);
  const fetchWithPayment = wrapFetchWithPayment(myFetch, paymentClient);

  let requestUrl;
  if (ENDPOINT.startsWith('/')) {
    requestUrl = `${URL}${ENDPOINT}`;
  } else if (ENDPOINT === 'prices' || ENDPOINT === 'metadatas') {
    const tokens = process.env.FATHOM_TEST_TOKENS || TOKEN;
    requestUrl = `${URL}/v1/${ENDPOINT}?tokens=${tokens}`;
  } else {
    requestUrl = `${URL}/v1/${ENDPOINT}?token=${TOKEN}`;
  }
  
  // Add a cache-buster to ensure we don't get a stale 402 challenge from the CDN
  const cb = `cb=${Date.now()}`;
  requestUrl += requestUrl.includes('?') ? `&${cb}` : `?${cb}`;
  
  console.error(`DEBUG: Sending request to endpoint...`);
  const res = await fetchWithPayment(requestUrl, { headers: { 'Connection': 'close', 'Cache-Control': 'no-cache' } });
  console.error(`DEBUG: Received response: ${res.status}`);
  
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  
  console.log(text);
  process.exit(0);
}

main().catch(e => {
  console.error("Helper error:", e);
  process.exit(1);
});
