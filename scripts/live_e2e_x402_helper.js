const { createWalletClient, http, encodeFunctionData, parseUnits, publicActions } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { baseSepolia, base } = require('viem/chains');

const PRIVATE_KEY = process.env.FATHOM_TEST_WALLET_PRIVATE_KEY;
const RECIPIENT = process.env.FATHOM_X402_RECIPIENT;
const AMOUNT = process.env.X402_PRICE_USDC || "0.01";

// For x402 on Base Sepolia
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable'
  }
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Missing FATHOM_TEST_WALLET_PRIVATE_KEY");
    process.exit(1);
  }
  if (!RECIPIENT) {
    console.error("Missing FATHOM_X402_RECIPIENT");
    process.exit(1);
  }

  const network = process.env.X402_NETWORK || "base-sepolia";
  const chain = network === "base" ? base : baseSepolia;
  const usdcAddress = network === "base" ? USDC_BASE : USDC_SEPOLIA;
  const rpcUrl = network === "base" ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL;

  try {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const client = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    }).extend(publicActions);

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [RECIPIENT, parseUnits(AMOUNT, 6)]
    });

    const hash = await client.sendTransaction({
      to: usdcAddress,
      data,
    });

    await client.waitForTransactionReceipt({ hash });

    // Output JSON with payment header
    const { encodePaymentSignatureHeader } = require('@x402/core/http');
    const header = encodePaymentSignatureHeader({
      x402Version: '2.0',
      payload: {
         signature: hash
      }
    });
    console.log(JSON.stringify({ header }));
  } catch (error) {
    console.error("Payment generation failed", error.message);
    process.exit(1);
  }
}

main();
