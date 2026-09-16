import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The licence split only means anything if the boundary it describes is real.
 *
 * The core is AGPL-3.0 and this package is Apache-2.0, which is only honest
 * while this package contains none of the core's code. One stray
 * `import '../../src/...'` would put an AGPL work inside an Apache one and
 * quietly hand a copyleft obligation to everyone who installs the kit. That is
 * not the sort of thing to leave to reviewer attention.
 */
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(KIT, '..');

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(full);
    }
    return /\.(ts|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('licence boundary', () => {
  const files = ['src', 'bin', 'test', 'examples'].flatMap(d => sourceFiles(path.join(KIT, d)));

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports nothing from the AGPL core', () => {
    const offenders: string[] = [];

    for (const file of files) {
      // Strip comments first. Prose about the rule - including the example in
      // this file's own header - is not an import, and the first version of
      // this test failed on its own docstring.
      const body = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      const specifiers = [
        ...body.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
        ...body.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)
      ].map(m => m[1]);

      for (const spec of specifiers) {
        if (!spec.startsWith('.')) continue;
        // Resolve against the importing file and check it still lands inside
        // the kit. Counting `../` is not enough — a path can climb out and
        // back in, and only the resolved location decides which licence applies.
        const resolved = path.resolve(path.dirname(file), spec);
        if (resolved.startsWith(KIT + path.sep)) continue;
        offenders.push(`${path.relative(REPO, file)} -> ${spec}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('declares Apache-2.0 and ships its text', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
    expect(pkg.license).toBe('Apache-2.0');

    const license = fs.readFileSync(path.join(KIT, 'LICENSE'), 'utf8');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
    // Apache's boilerplate ships with a placeholder that has to be filled in.
    expect(license).not.toContain('[name of copyright owner]');
  });

  it('keeps the core under AGPL, not silently relicensed with it', () => {
    const core = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
    expect(core).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    // Section 13 is the reason the core is AGPL rather than GPL at all.
    expect(core).toContain('Remote Network Interaction');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(rootPkg.license).toBe('AGPL-3.0-only');
  });

  it('carves out the documents destined for MIT registries', () => {
    const notice = fs.readFileSync(path.join(KIT, 'NOTICE'), 'utf8');
    expect(notice).toContain('MIT License');

    for (const doc of ['base-mcp/fathom.md', 'skills/fathom/SKILL.md']) {
      expect(fs.existsSync(path.join(KIT, doc)), `missing ${doc}`).toBe(true);
      expect(notice, `${doc} not named in NOTICE`).toContain(doc);
    }
  });
});
