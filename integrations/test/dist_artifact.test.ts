import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A build that exits 0 while producing an artifact nobody can run is not a build.
 *
 * These tests execute the emitted JavaScript with plain Node, exactly as a
 * consumer would. They deliberately do not import the TypeScript sources:
 * Vitest resolves those through Vite, which papers over precisely the module
 * resolution failures that made the first build unusable.
 *
 * `npm test` runs `pretest`, which builds. Raw `npx vitest run` does not, and
 * then `beforeAll` says so rather than failing obscurely.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'dist/bin/fathom-assess.js');
const ENTRY = resolve(ROOT, 'dist/src/index.js');

const PUBLIC_SURFACE = [
  'createFathomClient',
  'createFathomX402Fetch',
  'fathomActionProvider',
  'createFathomAssessTool',
  'CANONICAL_FATHOM_PAYMENT_TERMS',
  'FathomPaymentPolicyError'
];

function node(script: string): string {
  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

describe('built artifact', () => {
  // Importing the entry pulls viem, AgentKit and LangChain, which is slow. One
  // process answers every question about the entry rather than one per question.
  let entryReport: {
    exports: string[];
    subpaths: number;
    policy: { name: string; signed: number };
  };

  beforeAll(() => {
    if (!existsSync(CLI) || !existsSync(ENTRY)) {
      throw new Error('dist/ is missing — run `npm run build` (or `npm test`, which builds).');
    }

    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    const subpaths = Object.values(pkg.exports as Record<string, any>)
      .filter(v => typeof v === 'object' && v.import)
      .map(v => resolve(ROOT, v.import));

    entryReport = JSON.parse(
      node(`
        (async () => {
          const m = await import(${JSON.stringify(ENTRY)});
          const subs = await Promise.all(${JSON.stringify(subpaths)}.map(p => import(p)));

          let signed = 0;
          const signer = {
            address: '0x${'1'.repeat(40)}',
            signTypedData: async () => { signed++; return '0x'; }
          };
          const f = m.createFathomX402Fetch({
            signer,
            fetch: async () => { throw new Error('network reached'); }
          });
          let name = 'NO_ERROR';
          try { await f('https://evil.example/v1/assess'); } catch (e) { name = e.name; }

          process.stdout.write(JSON.stringify({
            exports: ${JSON.stringify(PUBLIC_SURFACE)}.filter(k => typeof m[k] !== 'undefined'),
            subpaths: subs.length,
            policy: { name, signed }
          }));
        })().catch(e => { process.stderr.write(String(e)); process.exit(1); });
      `)
    );
  }, 120_000);

  it('runs the CLI help with plain node', () => {
    const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });

    expect(out).toMatch(/fathom-assess/);
    expect(out).toMatch(/--token/);
    expect(out).toMatch(/NEVER pass a private key via command line/i);
  }, 60_000);

  it('keeps the shebang so the bin is executable', () => {
    expect(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('does not auto-run main when imported rather than executed', () => {
    // A wrong ESM entry check would print help or exit here. Anything other than
    // the export name on stdout means the module ran itself.
    const out = node(
      `import(${JSON.stringify(CLI)}).then(m => process.stdout.write(typeof m.main))`
    );

    expect(out).toBe('function');
  }, 60_000);

  it('imports the package entry and exposes the public surface', () => {
    expect(entryReport.exports).toEqual(PUBLIC_SURFACE);
  });

  it('resolves every declared subpath export', () => {
    expect(entryReport.subpaths).toBeGreaterThan(1);
  });

  it('enforces the payment policy from the built artifact, not just from source', () => {
    expect(entryReport.policy).toEqual({ name: 'FathomPaymentPolicyError', signed: 0 });
  });
});
