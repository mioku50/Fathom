const { createWalletClient, http, parseEther, encodeFunctionData, parseUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { baseSepolia } = require('viem/chains');

const PRIVATE_KEY = process.env.FATHOM_TEST_WALLET_PRIVATE_KEY;
const RECIPIENT = process.env.FATHOM_X402_RECIPIENT;
const AMOUNT = "0.01"; // Or process.env.X402_PRICE_USDC, default to 0.01

if (!PRIVATE_KEY) {
  console.error("Missing FATHOM_TEST_WALLET_PRIVATE_KEY");
  process.exit(1);
}

// Minimal ERC20 ABI for transfer
const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
];

// USDC on Base Sepolia
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  try {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const client = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org")
    });

    const amountWei = parseUnits(AMOUNT, 6);

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [RECIPIENT, amountWei]
    });

    // We can't actually send a transaction easily without a full node setup and gas,
    // and this is just to create a hash. For a true E2E script that makes a real payment,
    // it would use `client.sendTransaction`. Since this is a test environment, let's try.

    // As per instruction "Real x402 payment validation should be supported only from local env variables and only on Base Sepolia."
    const txHash = await client.sendTransaction({
      to: USDC_ADDRESS,
      data: data,
    });

    console.log(`x402 tx=${txHash}`);

  } catch (err) {
    console.error("Error creating payment proof:", err.message);
    process.exit(1);
  }
}

main();
