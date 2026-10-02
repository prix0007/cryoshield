/**
 * redesign-landing-and-app-ui 3.1 (spec landing-page "Honest landing content", "Story tiles",
 * "Landing accessibility and keyboard use"). Parses the source index.html (what ships, minus the injected CSP).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
const doc = new DOMParser().parseFromString(src, 'text/html');
const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
const REPO = 'https://github.com/prix0007/cryoshield';

describe('landing structure', () => {
  it('has exactly one h1, the hero headline', () => {
    const h1 = doc.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent?.trim()).toBe('Backups that outlive the drive.');
  });

  it('starts with a skip link to #main and has header/nav, main and footer landmarks', () => {
    const first = doc.body.querySelector('a[href]');
    expect(first?.getAttribute('href')).toBe('#main');
    expect(first?.classList.contains('skip-link')).toBe(true);
    expect(doc.querySelector('header nav[aria-label]')).not.toBeNull();
    expect(doc.querySelector('main#main')).not.toBeNull();
    expect(doc.querySelector('footer')).not.toBeNull();
  });

  it('presents the story tiles in order', () => {
    const ids = [...doc.querySelectorAll('main > section')].map((s) => s.id);
    expect(ids).toEqual(['hero', 'how', 'keys-only', 'lose-a-key', 'survives', 'free', 'faq']);
    const h2 = [...doc.querySelectorAll('main > section h2')].map((h) => h.textContent?.trim());
    expect(h2).toEqual(['How it works.', 'Only your keys open it.', 'Lose a key, not your vault.', 'Survives us too.', 'Free to use.', 'Questions, answered.']);
  });

  it('every story tile (and the hero) has one or two pill CTAs, and at least one leads somewhere real', () => {
    const tiles = [...doc.querySelectorAll('main > section[data-story]')];
    expect(tiles.length).toBe(6);
    for (const t of tiles) {
      const pills = [...t.querySelectorAll('a.pill')];
      expect(pills.length, t.id).toBeGreaterThanOrEqual(1);
      expect(pills.length, t.id).toBeLessThanOrEqual(2);
      for (const p of pills) expect(p.getAttribute('href'), t.id).toMatch(/^(\/app\/|#[a-z-]+|https:\/\/github\.com\/prix0007\/cryoshield)/);
    }
  });

  it('the "Open the app" CTA goes to /app/', () => {
    const open = [...doc.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Open the app');
    expect(open.length).toBeGreaterThanOrEqual(2);
    for (const a of open) expect(a.getAttribute('href')).toBe('/app/');
  });

  it('every graphic is decorative (aria-hidden), carries no inline style, and its tile states its meaning in text', () => {
    const svgs = [...doc.querySelectorAll('main svg')];
    expect(svgs.length).toBeGreaterThanOrEqual(6);
    for (const s of svgs) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.getAttribute('focusable')).toBe('false');
    }
    expect(src).not.toMatch(/\sstyle=|<style[\s>]/);
  });

  it('the footer links to the repository, the recovery tool docs and the license', () => {
    const hrefs = [...doc.querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(REPO);
    expect(hrefs).toContain(`${REPO}/tree/main/tools/recover#readme`);
    expect(hrefs).toContain(`${REPO}/blob/main/LICENSE`);
  });

  it('external links never open a new window and carry rel=noopener noreferrer', () => {
    for (const a of doc.querySelectorAll('a[href^="http"]')) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\/github\.com\/prix0007\/cryoshield/);
      expect(a.getAttribute('target')).toBeNull();
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

describe('honest copy', () => {
  it('states testnet (OP Sepolia), not audited, and all-keys-lost outside any collapsible', () => {
    const outsideDetails = [...doc.querySelectorAll('main > section')]
      .map((s) => {
        const c = s.cloneNode(true) as HTMLElement;
        c.querySelectorAll('details').forEach((d) => d.remove());
        return c.textContent ?? '';
      })
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(outsideDetails).toMatch(/OP Sepolia/);
    expect(outsideDetails).toMatch(/test network/i);
    expect(outsideDetails).toMatch(/not been independently audited/);
    expect(outsideDetails).toMatch(/If you lose every key, nobody can open the vault/);
  });

  it('makes no claim the code does not back up', () => {
    const banned = [
      /\bis audited\b/i,
      /\baudited by\b/i,
      /\bfully audited\b/i,
      /\bmainnet\b/i,
      /military[- ]grade/i,
      /bank[- ]grade/i,
      /unhackable/i,
      /100% (secure|safe)/i,
      /quantum[- ](proof|safe|resistant)/i,
      /\bL1 (hash )?anchor/i,
      /\bguarantee/i,
      /\bIPFS\b|\bENS\b/,
      /recover(y)? (after|without) (losing )?(all|every) keys?/i,
    ];
    for (const b of banned) expect(text, String(b)).not.toMatch(b);
  });

  it('uses no Apple names or marks', () => {
    expect(text).not.toMatch(/\b(Apple|iPhone|iPad|Mac|macOS|Safari|iCloud|Touch ID|Face ID|SF Pro)\b/);
  });
});
