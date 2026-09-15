import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const skillPath = path.resolve(__dirname, '../skills/fathom/SKILL.md');
const mcpPath = path.resolve(__dirname, '../base-mcp/fathom.md');

describe('Unified Skill: skills/fathom/SKILL.md (Hermes & OpenClaw)', () => {
  const content = fs.readFileSync(skillPath, 'utf8');

  it('exists and has valid frontmatter', () => {
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(content.startsWith('---')).toBe(true);
    expect(content).toMatch(/name:\s*fathom/);
    expect(content).toMatch(/description:\s*.+/);
  });

  it('contains primary endpoint /v1/assess', () => {
    expect(content).toContain('/v1/assess');
  });

  it('declares payment terms of 0.001 USDC', () => {
    expect(content).toContain('0.001 USDC');
  });

  it('explicitly states that unverified is not a negative verdict', () => {
    expect(content).toMatch(/unverified.*never.*negative/i);
  });

  it('contains no honeypot or scam protection claim, and explicitly disclaims them', () => {
    expect(content).toMatch(/no.*claim.*(?:scam|honeypot)/i);
  });

  it('forbids asking for private keys in chat', () => {
    expect(content).toMatch(/private key/i);
    expect(content).toMatch(/never.*ask.*private key.*chat/i);
  });

  it('specifies execution priority', () => {
    expect(content).toMatch(/execution priority/i);
    expect(content).toMatch(/runtime-native/i);
    expect(content).toMatch(/CLI/i);
  });
});

describe('Base MCP Plugin Spec: base-mcp/fathom.md', () => {
  const content = fs.readFileSync(mcpPath, 'utf8');
  const frontmatter = content.split('---')[1] ?? '';
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();

  /**
   * Conformance is by review upstream - no validator runs in the Base repo -
   * so these assert the spec's own Authoring Checklist against the file we
   * would submit. The previous version of this suite checked a frontmatter
   * shape we had invented ourselves, which passed happily while the file was
   * not submittable at all.
   *
   * Spec: https://github.com/base/skills/blob/master/skills/base-mcp/references/plugin-spec.md
   */

  it('declares every required frontmatter field', () => {
    for (const required of ['title', 'description', 'tags', 'name', 'version', 'integration', 'chains']) {
      expect(field(required), `missing frontmatter: ${required}`).toBeTruthy();
    }
    expect(field('name')).toBe('fathom');
    expect(field('version')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('uses valid enum values for the capability flags', () => {
    expect(field('integration')).toBe('http-api');
    expect(frontmatter).toMatch(/^\s+shell:\s*(required|optional|none)$/m);
    expect(field('auth')).toMatch(/^(none|api-key|siwe-jwt|oauth-on-install)$/);

    const risks = (field('risk') ?? '[]').replace(/[[\]]/g, '').split(',').map(r => r.trim()).filter(Boolean);
    const vocabulary = ['liquidation', 'slippage', 'low-liquidity', 'pii', 'irreversible', 'local-exec'];
    for (const r of risks) expect(vocabulary, `unknown risk tag: ${r}`).toContain(r);
    // Paid x402 calls spend real USDC that cannot be recalled; the native
    // plugins that take payment all carry this tag.
    expect(risks).toContain('irreversible');
  });

  it('carries 3-5 discovery tags', () => {
    const tags = (field('tags') ?? '').replace(/[[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
    expect(tags.length).toBeGreaterThanOrEqual(3);
    expect(tags.length).toBeLessThanOrEqual(5);
    for (const t of tags) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('opens with the onboarding callout before any section', () => {
    const callout = content.indexOf('> [!IMPORTANT]');
    expect(callout).toBeGreaterThan(-1);
    expect(callout).toBeLessThan(content.indexOf('## Overview'));
  });

  it('includes every required section, in canonical order', () => {
    // http-api implies Endpoints; a non-empty risk implies Risks & Warnings.
    const required = [
      '## Overview',
      '## Surface Routing',
      '## Endpoints',
      '## Orchestration',
      '## Submission',
      '## Example Prompts',
      '## Risks & Warnings'
    ];
    const positions = required.map(h => {
      const at = content.indexOf(`\n${h}`);
      expect(at, `missing section: ${h}`).toBeGreaterThan(-1);
      return at;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('uses canonical heading names, not the synonyms the spec renames', () => {
    for (const synonym of [
      '## Safety Rules', '## Safety Notes', '## Execution Warnings', '## Important Notes',
      '## Orchestration Pattern', '## API Services', '## Auth Headers',
      '## Environment Detection', '## Base MCP Conversion', '## Example Flows',
      '## Architecture', '## Invocation Rules', '## Execution Flow'
    ]) {
      expect(content, `non-canonical heading: ${synonym}`).not.toContain(synonym);
    }
  });

  it('omits the sections its integration type forbids', () => {
    // http-api is not external-mcp, so there is no MCP catalog to detect or install.
    expect(content).not.toContain('## Detection');
    expect(content).not.toContain('## Installation');
    // auth: none means no Auth section.
    expect(content).not.toContain('## Auth\n');
  });

  it('names a concrete submission target', () => {
    const submission = content.slice(content.indexOf('## Submission'), content.indexOf('## Example Prompts'));
    expect(submission).toMatch(/send_calls|swap|sign|no Base MCP submission tool/);
    expect(submission).toMatch(/x402 payment tool/i);
    // A data endpoint has no calldata to batch.
    expect(submission).toMatch(/not calldata/i);
  });

  it('points reference links at the sibling references directory', () => {
    const links = [...content.matchAll(/\]\((\.[^)]+)\)/g)].map(m => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l, `bad relative link: ${l}`).toMatch(/^\.\.\/references\//);
  });

  it('states the shell-less surface behaviour rather than leaving it open', () => {
    const routing = content.slice(content.indexOf('## Surface Routing'), content.indexOf('## Endpoints'));
    expect(routing).toMatch(/chat-only/i);
    expect(routing).toMatch(/stop/i);
  });

  it('gives at least two worked example prompts', () => {
    const examples = content.slice(content.indexOf('## Example Prompts'), content.indexOf('## Risks & Warnings'));
    expect((examples.match(/^\*\*/gm) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the canonical payment terms, verified against the live challenge', () => {
    expect(content).toContain('fathom-api.mioku-fathom.workers.dev');
    expect(content).toContain('0.001 USDC');
    expect(content).toContain('eip155:8453');
    expect(content).toContain('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(content).toContain('0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909');
    expect(content).toContain('bc_tzj2linw');
  });

  it('never promises trading, and never sells unverified as a negative', () => {
    expect(content).toMatch(/never executes a swap|never execute a swap|never trades/i);
    expect(content).toMatch(/unverified.*not a negative|not a negative verdict/i);
    expect(content).toMatch(/does not claim scam or honeypot protection/i);
  });
});
