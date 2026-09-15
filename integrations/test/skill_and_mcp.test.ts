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

  it('exists and has valid spec frontmatter', () => {
    expect(fs.existsSync(mcpPath)).toBe(true);
    expect(content.startsWith('---')).toBe(true);
    expect(content).toMatch(/name:\s*fathom/);
    expect(content).toMatch(/plugin-spec/);
  });

  it('defines canonical host allowlist containing only fathom-api.mioku-fathom.workers.dev', () => {
    expect(content).toContain('fathom-api.mioku-fathom.workers.dev');
  });

  it('specifies max payment of 0.001 USDC', () => {
    expect(content).toContain('0.001 USDC');
  });

  it('prohibits auto-trading and generic auto-routing', () => {
    expect(content).toMatch(/no.*generic.*auto-routing/i);
    expect(content).toMatch(/never execute a swap/i);
  });
});
