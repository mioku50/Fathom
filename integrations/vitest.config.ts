import { defineConfig } from 'vitest/config';

// The integrations sub-package must not inherit the root Worker config.
// Without an own config, Vitest walks up to /home/mioku/Fathom/vitest.config.ts
// and adopts its `include: ['tests/**/*.test.ts']`, which matches nothing here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
});
