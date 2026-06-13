import { createPublicClient, http, fallback } from 'viem';
import { base } from 'viem/chains';

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: fallback([
      http('https://fake-url-1.com/asdfasdf'),
      http('https://fake-url-2.com/asdfasdf')
    ])
  });

  try {
    await client.getBlockNumber();
  } catch (e: any) {
    console.error(e.message);
  }
}

main();
