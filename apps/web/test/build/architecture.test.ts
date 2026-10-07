// @vitest-environment jsdom
/** add-architecture-page 1.1 (spec architecture-page): structure, CSP-clean markup, live values, links. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderApp } from '../ui/helpers';

const web = join(__dirname, '..', '..');
let out = '';
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'cs-arch-'));
  // Build from .env.e2e only: drop any VITE_* the test runner loaded into process.env (they would override the mode).
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...clean, NODE_ENV: 'production' } });
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const html = (p: string) => readFileSync(join(out, p), 'utf8');
const doc = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
const env = Object.fromEntries(
  readFileSync(join(web, '.env.e2e'), 'utf8')
    .split('\n')
    .filter((l) => /^VITE_[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

describe('/architecture page', () => {
  it('is emitted with the heading, three accessible figures and the flow lists', () => {
    expect(existsSync(join(out, 'architecture', 'index.html'))).toBe(true);
    const d = doc('architecture/index.html');
    expect(d.querySelector('main h1')?.textContent?.trim()).toBe('CryoShield system map');
    const svgs = [...d.querySelectorAll('main svg[role="img"]')];
    expect(svgs).toHaveLength(3);
    for (const s of svgs) {
      expect(s.getAttribute('aria-label')?.length).toBeGreaterThan(20);
      expect(s.closest('figure')?.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
    }
    expect(d.querySelectorAll('main ol li').length).toBeGreaterThanOrEqual(8);
    const ids = [...d.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of d.querySelectorAll('marker')) expect(m.id).toMatch(/^arch-/);
  });

  it('is CSP-clean: no style attributes or elements, no script, no var() in attributes; the app CSP', () => {
    const h = html('architecture/index.html');
    expect(h).not.toMatch(/\sstyle=|<style[\s>]|<script|="var\(/i);
    const csp = (p: string) => html(p).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
    expect(csp('architecture/index.html')).toBe(csp('app/index.html'));
    for (const m of h.matchAll(/<(?:link(?! rel="canonical")|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/g)) expect(m[1]).toMatch(/^(\/|data:)/);
  });

  it('freshness guard: live values equal the deployment record and the config', () => {
    const chainId = Number(env.VITE_CHAIN_ID);
    const contractsDir = process.env.CRYOSHIELD_CONTRACTS_DIR ?? join(web, '..', '..', 'contracts');
    const dep = JSON.parse(readFileSync(join(contractsDir, 'deployments', `${chainId}.json`), 'utf8'));
    const d = doc('architecture/index.html');
    const value = (label: string) => [...d.querySelectorAll('section[aria-labelledby="s5"] tr')].find((tr) => tr.querySelector('th')?.textContent?.trim() === label)?.querySelector('td')?.textContent?.trim();
    // harden-gas-sponsorship: v2 takes every write; v1 is shown as read-only; our factory for this build's RP ID.
    expect(value('VaultRegistry v2')).toBe(dep.contracts.vaultRegistryV2.address);
    expect(value('Deploy block')).toBe(String(dep.contracts.vaultRegistryV2.deployBlock));
    expect(value('VaultRegistry v1')).toBe(`${dep.address} (read-only)`);
    expect(value('Account factory')).toBe(dep.contracts.wallets[env.VITE_RP_ID!].factory);
    expect(value('Account implementation')).toBe(dep.contracts.wallets[env.VITE_RP_ID!].implementation);
    expect(value('Vault limits')).not.toMatch(/16 vaults per locator$/);
    expect(value('Network')).toContain(`chain ${chainId}`);
    expect(value('WebAuthn RP ID')).toContain(env.VITE_RP_ID);
    expect(html('architecture/index.html')).not.toMatch(/__CS_[A-Z_]+__/);
  });

  it('is linked from the landing page and the legal pages', () => {
    for (const p of ['index.html', 'privacy/index.html', 'terms/index.html', 'cookies/index.html', 'architecture/index.html']) {
      expect([...doc(p).querySelectorAll('a')].map((a) => a.getAttribute('href')), p).toContain('/architecture');
    }
  });
});

describe('app footer link', () => {
  it('links to /architecture', () => {
    renderApp();
    expect(screen.getByRole('link', { name: 'System design' })).toHaveAttribute('href', '/architecture');
  });
});
void render;
