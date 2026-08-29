#!/usr/bin/env node
/**
 * Did that payment actually happen on chain?
 *
 * An x402 "exact" payment is an EIP-3009 TransferWithAuthorization: the payer
 * signs an authorization carrying a one-time nonce, and USDC marks that nonce
 * used when it is redeemed. So the authoritative answer to "was I paid" is not
 * the HTTP status and not the facilitator's word - it is whether the nonce was
 * consumed and whether the transfer event exists.
 *
 * Usage:
 *   node scripts/check_payment_proof.js <X-PAYMENT base64> [PAYMENT-RESPONSE base64]
 */

const { createPublicClient, http, parseAbiItem, formatUnits, getAddress } = require('viem');
const fs = require('fs');

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function rpcUrl() {
  if (process.env.PRICE_RPC_URL) return process.env.PRICE_RPC_URL;
  const devVars = require('path').join(__dirname, '..', '.dev.vars');
  if (fs.existsSync(devVars)) {
    const m = fs.readFileSync(devVars, 'utf8').match(/^PRICE_RPC_URL=(.*)$/m);
    if (m) return m[1].trim();
  }
  // Any Base mainnet endpoint answers these reads.
  return 'https://mainnet.base.org';
}

function decode(b64, label) {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error(`Could not decode ${label}: ${e.message}`);
  }
}

(async () => {
  const [xPayment, paymentResponse] = process.argv.slice(2);
  if (!xPayment) {
    console.error('usage: node scripts/check_payment_proof.js <X-PAYMENT base64> [PAYMENT-RESPONSE base64]');
    process.exit(2);
  }

  const payment = decode(xPayment, 'X-PAYMENT');
  const auth = payment?.payload?.authorization;
  if (!auth) throw new Error('No payload.authorization in the X-PAYMENT header');

  const from = getAddress(auth.from);
  const to = getAddress(auth.to);
  const nonce = auth.nonce;

  console.log('=== authorization ===');
  console.log('x402Version :', payment.x402Version);
  console.log('scheme      :', payment.scheme);
  console.log('network     :', payment.network);
  console.log('from        :', from);
  console.log('to          :', to);
  console.log('value       :', auth.value, `(${Number(auth.value) / 1e6} USDC)`);
  console.log('nonce       :', nonce);

  const client = createPublicClient({ transport: http(rpcUrl()) });

  // USDC records every redeemed authorization, so this cannot be faked or
  // guessed at: true means the money moved, false means it never did.
  const used = await client.readContract({
    address: USDC,
    abi: [{
      name: 'authorizationState',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ type: 'address' }, { type: 'bytes32' }],
      outputs: [{ type: 'bool' }]
    }],
    functionName: 'authorizationState',
    args: [from, nonce]
  });

  console.log('');
  console.log('=== on-chain verdict ===');
  console.log(used
    ? 'nonce CONSUMED - this authorization was redeemed on Base'
    : 'nonce UNUSED   - this authorization has never been redeemed');

  if (paymentResponse) {
    const settled = decode(paymentResponse, 'PAYMENT-RESPONSE');
    console.log('');
    console.log('=== what the facilitator claimed ===');
    console.log(JSON.stringify(settled, null, 2));

    const txHash = settled.transaction || settled.txHash || settled?.payload?.transaction;
    if (txHash && /^0x[0-9a-f]{64}$/i.test(txHash)) {
      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
      console.log('');
      console.log('=== that transaction on Base ===');
      console.log(receipt
        ? `status ${receipt.status}, block ${receipt.blockNumber}`
        : 'NOT FOUND on Base - the facilitator reported a transaction that is not on chain');
    }
  }

  // Ground truth from the other direction: the transfer event itself.
  const head = await client.getBlockNumber();
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    const hi = head - BigInt(i * 900);
    const lo = hi - 899n;
    const logs = await client.getLogs({
      address: USDC,
      event: parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)'),
      args: { from, to },
      fromBlock: lo,
      toBlock: hi
    }).catch(() => []);
    if (logs.length) found = logs[logs.length - 1];
  }

  console.log('');
  console.log('=== transfer events ===');
  if (found) {
    console.log(`${formatUnits(found.args.value, 6)} USDC  ${from} -> ${to}`);
    console.log(`tx ${found.transactionHash}`);
  } else {
    console.log(`no ${from} -> ${to} USDC transfer in roughly the last 20 hours`);
  }
})().catch(e => {
  console.error('error:', e.message);
  process.exit(1);
});
