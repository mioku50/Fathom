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

  const network = process.env.X402_NETWORK || "base-sepolia";
  const chain = network === "base" ? base : baseSepolia;
  const rpcUrl = network === "base" ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL;

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

  const requestUrl = `${URL}/v1/${ENDPOINT}?token=${TOKEN}`;
  console.error("DEBUG: Sending request...");
  const res = await fetchWithPayment(requestUrl, { headers: { 'Connection': 'close' } });
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
