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

  it('presents the story in order: hero, numbers, six scenes, free, final CTA, FAQ', () => {
    const ids = [...doc.querySelectorAll('main > section')].map((s) => s.id);
    expect(ids).toEqual(['hero', 'numbers', 'fragile', 'how', 'stored', 'only-you', 'lose-a-key', 'survives', 'timeline', 'free', 'start', 'faq']);
    const h2 = [...doc.querySelectorAll('main > section h2')].map((h) => h.textContent?.trim());
    expect(h2).toEqual([
      'By the numbers.',
      'Drives fail. Paper fades.',
      'One tap. Sealed in your browser.',
      'Stored on-chain. Copied to Arweave.',
      'Only you can read it.',
      'Lose a key, not your vault.',
      'Survives us too.',
      'Built for decades.',
      'Free to use.',
      'Back it up once.',
      'Questions, answered.',
    ]);
  });

  it('the six scenes are pinned-scene sections with a track, a sticky stage and a decorative visual', () => {
    const scenes = [...doc.querySelectorAll('main > section[data-scene]')];
    expect(scenes.map((s) => s.getAttribute('data-scene'))).toEqual(['fragile', 'tap', 'chain', 'lose', 'survive', 'timeline']);
    for (const sc of scenes) {
      expect(sc.querySelector(':scope > .scene-track > .scene-stage'), sc.id).not.toBeNull();
      expect(sc.querySelector('.scene-stage h2'), sc.id).not.toBeNull();
      expect(sc.querySelector('.scene-visual svg[aria-hidden="true"]'), sc.id).not.toBeNull();
      expect(sc.querySelectorAll('a.pill').length, sc.id).toBeLessThanOrEqual(2);
    }
  });

  it('hero, Free to use and the final CTA each have one or two pills; every pill goes somewhere real', () => {
    for (const id of ['hero', 'free', 'start']) {
      const n = doc.querySelectorAll(`#${id} a.pill`).length;
      expect(n, id).toBeGreaterThanOrEqual(1);
      expect(n, id).toBeLessThanOrEqual(2);
    }
    for (const p of doc.querySelectorAll('main a.pill')) expect(p.getAttribute('href')).toMatch(/^(\/app\/|\/architecture|#[a-z-]+|https:\/\/github\.com\/prix0007\/cryoshield)/);
  });

  it('the numbers band shows its final values in the HTML (no JS needed)', () => {
    const vals = [...doc.querySelectorAll('#numbers [data-count]')].map((e) => e.textContent?.trim());
    expect(vals).toEqual(['1', '2+', '0', '$0', '~1 KB']);
  });

  it('the timeline names what permanence depends on', () => {
    const t = (doc.querySelector('#timeline')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toMatch(/blockchain/);
    expect(t).toMatch(/Arweave/);
    expect(t).toMatch(/at least one of your keys/);
  });

  it('the "Open the app" CTA goes to /app/', () => {
    const open = [...doc.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Open the app');
    expect(open.length).toBeGreaterThanOrEqual(2);
    for (const a of open) expect(a.getAttribute('href')).toBe('/app/');
  });

  it('every graphic is decorative (aria-hidden), carries no inline style, and its tile states its meaning in text', () => {
    const svgs = [...doc.querySelectorAll('main svg')];
    expect(svgs.length).toBeGreaterThanOrEqual(7);
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
      /guaranteed/i,
      /\bforever\b/i,
      /unbreakable/i,
      /never lose/i,
    ];
    for (const b of banned) expect(text, String(b)).not.toMatch(b);
  });

  it('uses no Apple names or marks', () => {
    expect(text).not.toMatch(/\b(Apple|iPhone|iPad|Mac|macOS|Safari|iCloud|Touch ID|Face ID|SF Pro)\b/);
  });
});

describe('"Only you can read it." comparison (landing-only-you-can-read 1.1)', () => {
  const tile = doc.querySelector('#only-you')!;
  const t = (tile?.textContent ?? '').replace(/\s+/g, ' ');

  it('is a light tile with the checked headline and body', () => {
    expect(tile.classList.contains('tile-parchment') || tile.classList.contains('tile-light')).toBe(true);
    expect(t).toContain('Your secrets are locked on your device before anything leaves it. The keys that open them live in the security keys you hold, never with us or anyone else.');
  });

  it('has an accessible table: caption, column headers, four row headers with answers', () => {
    const table = tile.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent?.trim()).toBeTruthy();
    expect([...table.querySelectorAll('thead th')].map((th) => [th.getAttribute('scope'), th.textContent?.trim()])).toEqual([
      ['col', 'Typical cloud storage'],
      ['col', 'CryoShield'],
    ]);
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [tr.querySelector('th[scope="row"]')?.textContent?.trim(), ...[...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim())]);
    expect(rows).toEqual([
      ['Who can read your data', 'You, and the provider (who holds or can reset the keys)', 'Only you'],
      ['Account and password to lose or have hacked', 'Yes', 'None'],
      ['Can be frozen, deleted or shut down', 'Yes, by the provider', 'No: stored on a public blockchain and Arweave'],
      ['Works if the company disappears', 'No', 'Yes: the open-source recovery tool reads it directly'],
    ]);
  });

  it('keeps the honesty fine print directly after the table', () => {
    const after = tile.querySelector('.table-wrap, table')!.nextElementSibling!;
    expect(after.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Some password managers also encrypt end to end. The difference is that CryoShield has no account, no servers holding your data, and no company you have to outlast.',
    );
  });

  it('never claims the data stays on the device, and names no competitor', () => {
    expect(t).not.toMatch(/stays on your device|never leaves your device|remains on your device/i);
    expect(t).not.toMatch(/\b(Google|Drive|iCloud|Dropbox|OneDrive|Box|1Password|LastPass|Bitwarden|Dashlane|Keeper|Proton|Ledger|Trezor)\b/);
  });
});
