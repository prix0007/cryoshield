/**
 * redesign-landing-and-app-ui 3.1 (spec landing-page "Honest landing content", "Story tiles",
 * "Landing accessibility and keyboard use"). Parses the source index.html (what ships, minus the injected CSP).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED, bannedFor } from './banned';
import { resolveNetworkCopy } from '../../vite-plugins/network-copy';

/** launch-op-mainnet 4.2: the page as the build ships it for a chain (network blocks resolved; scripts never run). */
const raw = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
function landing(chainId: number) {
  const src = resolveNetworkCopy(raw, { chainId, rpId: 'cryoshield.app', now: Date.parse('2026-10-09T00:00:00Z'), rpc: { host: 'rpc.example', vendor: 'Example' } });
  const doc = new DOMParser().parseFromString(src, 'text/html');
  return { src, doc, text: (doc.body.textContent ?? '').replace(/\s+/g, ' ') };
}
const { src, doc, text } = landing(11155420);
/** Visible text outside any collapsible (the FAQ answers are behind <details>). */
const outsideDetails = (d: Document) =>
  [...d.querySelectorAll('main > section')]
    .map((s) => {
      const c = s.cloneNode(true) as HTMLElement;
      c.querySelectorAll('details').forEach((x) => x.remove());
      return c.textContent ?? '';
    })
    .join(' ')
    .replace(/\s+/g, ' ');
const REPO = 'https://github.com/prix0007/cryoshield';
const BREACH_SOURCES = [
  { name: 'BleepingComputer', href: 'https://www.bleepingcomputer.com/news/security/cryptocurrency-theft-attacks-traced-to-2022-lastpass-breach/' },
  { name: 'Kaspersky', href: 'https://www.kaspersky.com/about/press-releases/kaspersky-discovers-new-crypto-stealing-trojan-in-appstore-and-google-play' },
  { name: 'The Block', href: 'https://www.theblock.co/post/161425/slope-wallet-provider-saved-user-seed-phrases-in-plain-text-solana-security-researchers-find' },
] as const;

describe('landing structure', () => {
  it('has exactly one h1, the hero headline', () => {
    const h1 = doc.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent?.trim()).toBe('Seed phrase backups that outlive the drive.');
    expect(h1[0]!.getAttribute('aria-label')).toBe('Seed phrase backups that outlive the drive.');
  });

  it('starts with a skip link to #main and has header/nav, main and footer landmarks', () => {
    const first = doc.body.querySelector('a[href]');
    expect(first?.getAttribute('href')).toBe('#main');
    expect(first?.classList.contains('skip-link')).toBe(true);
    expect(doc.querySelector('header nav[aria-label]')).not.toBeNull();
    expect(doc.querySelector('main#main')).not.toBeNull();
    expect(doc.querySelector('footer')).not.toBeNull();
  });

  it('presents the story in order: hero, numbers, six scenes and the breaches tile, free, final CTA, FAQ', () => {
    const ids = [...doc.querySelectorAll('main > section')].map((s) => s.id);
    expect(ids).toEqual(['hero', 'numbers', 'fragile', 'breaches', 'how', 'stored', 'only-you', 'lose-a-key', 'survives', 'timeline', 'free', 'start', 'faq']);
    const h2 = [...doc.querySelectorAll('main > section h2')].map((h) => h.textContent?.trim());
    expect(h2).toEqual([
      'By the numbers.',
      'Drives fail. Paper fades.',
      'Where backups leak.',
      'One tap. Sealed in your browser.',
      'Stored on-chain. Copied to Arweave.',
      'Only you can read it.',
      'Lose a key, not your vault.',
      'Survives us too.',
      'Built for decades.',
      'Free to use.',
      'Back up your seed phrase once.',
      'Backup questions, answered.',
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
    for (const id of ['hero', 'breaches', 'free', 'start']) {
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
    // add-landing-breaches D4: besides the repository, only the three cited breach sources.
    const sources = new Set<string>(BREACH_SOURCES.map((x) => x.href));
    for (const a of doc.querySelectorAll('a[href^="http"]')) {
      const href = a.getAttribute('href')!;
      if (!sources.has(href)) expect(href).toMatch(/^https:\/\/github\.com\/prix0007\/cryoshield/);
      expect(a.getAttribute('target')).toBeNull();
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

describe('honest copy', () => {
  it('states testnet (OP Sepolia), not audited, and all-keys-lost outside any collapsible', () => {
    const t = outsideDetails(doc);
    expect(t).toMatch(/OP Sepolia/);
    expect(t).toMatch(/Testnet preview/);
    expect(t).toMatch(/test network/i);
    expect(t).toMatch(/not been independently audited/);
    expect(t).toMatch(/If you lose every key, nobody can open the vault/);
  });

  it('makes no claim the code does not back up', () => {
    // improve-landing-seo (spec "Honest drama"): "forever" only as the user's own question and its negating answer.
    const head = `${doc.title} ${doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''}`;
    const allowed = (t: string) => t.replace('How do I back up my seed phrase forever?', '').replace('No backup lasts forever', '');
    for (const b of BANNED) {
      expect(allowed(text), String(b)).not.toMatch(b);
      expect(head, String(b)).not.toMatch(b);
    }
    expect(text.match(/forever/gi)).toHaveLength(2);
  });

  it('answers "forever" honestly: the chain and Arweave dependency, a working key, the testnet', () => {
    const d = [...doc.querySelectorAll('#faq details')].find((x) => x.querySelector('summary')?.textContent === 'How do I back up my seed phrase forever?')!;
    const a = (d.querySelector('p')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(a).toMatch(/^No backup lasts forever/);
    expect(a).toMatch(/blockchain/);
    expect(a).toMatch(/Arweave/);
    expect(a).toMatch(/at least one of your keys/);
    expect(a).toMatch(/testnet/i);
  });

  it('uses no Apple names or marks', () => {
    expect(text).not.toMatch(/\b(Apple|iPhone|iPad|Mac|macOS|Safari|iCloud|Touch ID|Face ID|SF Pro)\b/);
  });
});

/**
 * launch-op-mainnet 4.2 (spec landing-page "Honest landing content", both scenarios): the same page built for OP Sepolia
 * and for OP Mainnet. Scripts never run here (static HTML), so this is what a visitor sees with scripts off.
 */
describe('honest copy follows the build chain (launch-op-mainnet 4.2)', () => {
  const testnet = landing(11155420);
  const mainnet = landing(10);
  const norm = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const head = (d: Document) => `${d.title} ${d.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''}`;

  it('OP Mainnet: names OP Mainnet, says unaudited and the all-keys-lost rule outside any collapsible; no testnet wording', () => {
    const t = outsideDetails(mainnet.doc);
    expect(t).toMatch(/OP Mainnet/);
    expect(t).toMatch(/not been independently audited/);
    expect(t).toMatch(/If you lose every key, nobody can open the vault/);
    for (const all of [mainnet.text, head(mainnet.doc), mainnet.src]) expect(all).not.toMatch(/OP Sepolia|testnet|test network/i);
  });

  it('OP Mainnet: the chips, the hero strip and the calls to action carry the new status', () => {
    expect(norm(mainnet.doc.querySelector('.sub-nav .chip'))).toBe('Unaudited');
    expect(norm(mainnet.doc.querySelector('#hero .status-strip'))).toBe(
      'Runs on OP Mainnet. Your vault is encrypted on your device and stored on OP Mainnet, with an extra copy on Arweave when that upload succeeds. CryoShield has not been independently audited, so please keep your existing backups too.',
    );
    for (const sel of ['#breaches .breach-cta .fine', '#start .fine']) {
      expect(norm(mainnet.doc.querySelector(sel)), sel).toBe('Runs on OP Mainnet, not independently audited. Please keep your existing backups too.');
    }
    expect(norm(mainnet.doc.querySelector('footer .legal'))).toBe('CryoShield contributors. MIT licensed. Runs on OP Mainnet, not independently audited. YubiKey is a trademark of Yubico.');
    expect(mainnet.doc.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/Free, open source, unaudited\.$/);
  });

  it('OP Sepolia: the testnet wording is unchanged', () => {
    expect(norm(testnet.doc.querySelector('.sub-nav .chip'))).toBe('Testnet preview');
    expect(norm(testnet.doc.querySelector('#hero .status-strip'))).toBe(
      'Testnet preview. Your vault is encrypted on your device and stored on OP Sepolia, a test network, with an extra copy on Arweave when that upload succeeds. Test networks can be reset, and CryoShield has not been independently audited yet.',
    );
    for (const sel of ['#breaches .breach-cta .fine', '#start .fine']) {
      expect(norm(testnet.doc.querySelector(sel)), sel).toBe('Testnet preview on OP Sepolia, not independently audited. Please keep your existing backups too.');
    }
    expect(testnet.doc.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/Free, open source, testnet\.$/);
  });

  it('OP Mainnet: the FAQ answers name OP Mainnet and the audit status, and "forever" stays honest', () => {
    const answer = (q: string) => norm([...mainnet.doc.querySelectorAll('#faq details')].find((x) => x.querySelector('summary')?.textContent === q)?.querySelector('p'));
    const forever = answer('How do I back up my seed phrase forever?');
    expect(forever).toMatch(/^No backup lasts forever/);
    expect(forever).toMatch(/at least one of your keys/);
    expect(forever).toMatch(/OP Mainnet/);
    expect(forever).toMatch(/not been independently audited/);
    expect(answer('Is it safe to use today?')).toMatch(/^CryoShield runs on OP Mainnet and has not been independently audited\./);
    expect(answer('Where should I store 2FA backup codes?')).toMatch(/not been independently audited, keep a printed copy/);
    expect(mainnet.text.match(/forever/gi)).toHaveLength(2);
  });

  it.each([
    ['OP Sepolia', 11155420],
    ['OP Mainnet', 10],
  ] as const)('%s: the denylist finds no affirmative claim, in the text or the head', (_n, chainId) => {
    const page = landing(chainId);
    const allowed = (t: string) => t.replace('How do I back up my seed phrase forever?', '').replace('No backup lasts forever', '');
    for (const b of bannedFor(chainId)) {
      expect(allowed(page.text), String(b)).not.toMatch(b);
      expect(head(page.doc), String(b)).not.toMatch(b);
    }
  });

  it('the mainnet denylist allows "OP Mainnet" only as the name, and never a readiness claim', () => {
    const b = bannedFor(10);
    const hit = (t: string) => b.some((r) => r.test(t));
    expect(hit('Runs on OP Mainnet.')).toBe(false);
    for (const t of ['Now on mainnet.', 'Mainnet-ready', 'OP Mainnet-ready', 'production ready', 'Battle-tested', 'It is audited.']) expect(hit(t), t).toBe(true);
    expect(bannedFor(11155420).some((r) => r.test('Runs on OP Mainnet.'))).toBe(true);
    expect(bannedFor(999).some((r) => r.test('Runs on OP Mainnet.'))).toBe(true); // unknown chain = testnet
  });

  it('4.6: the production testnet build carries the dated "moving" strip only in its window, never on dev', () => {
    const at = (rpId: string, now: string) =>
      new DOMParser().parseFromString(
        resolveNetworkCopy(raw, { chainId: 11155420, rpId, now: Date.parse(now), rpc: { host: 'h', vendor: 'v' }, dates: { moveNoticeFrom: '2026-10-12', switchDate: '2026-10-19' } }),
        'text/html',
      );
    const strips = (d: Document) => [...d.querySelectorAll('#hero .status-strip')].map((p) => norm(p));
    const MOVING = 'CryoShield is moving to OP Mainnet. Vaults created during the testnet preview will not move; you can still read them with the recovery tool. Create a new vault after the switch.';
    expect(strips(at('cryoshield.app', '2026-10-15T00:00:00Z'))).toContain(MOVING);
    expect(strips(at('cryoshield.app', '2026-10-19T00:00:00Z'))).not.toContain(MOVING);
    expect(strips(at('cryoshield-web-dev.fly.dev', '2026-10-15T00:00:00Z'))).not.toContain(MOVING);
    // The one deliberate exception to "no mainnet on a testnet build" (design D6): the dated notice names the target
    // network. Everything else on the page still passes the testnet denylist.
    const d = at('cryoshield.app', '2026-10-15T00:00:00Z');
    const rest = (d.body.textContent ?? '').replace(/\s+/g, ' ').replace(MOVING, '').replace('How do I back up my seed phrase forever?', '').replace('No backup lasts forever', '');
    for (const b of BANNED) expect(rest, String(b)).not.toMatch(b);
  });

  it('every network block in the source resolves, and no unresolved marker ships for either chain', () => {
    expect(raw).toMatch(/<!--net:testnet-->/);
    expect(raw).toMatch(/<!--net:mainnet-->/);
    for (const p of [testnet, mainnet]) expect(p.src).not.toMatch(/<!--\/?net|__CS_NET_/);
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

describe('search keywords and FAQ (improve-landing-seo)', () => {
  const questions = [...doc.querySelectorAll('#faq details > summary')].map((q) => q.textContent?.trim());

  it('the FAQ is visible disclosures under an h2 and asks the questions people search for', () => {
    expect(doc.querySelector('#faq > h2')).not.toBeNull();
    for (const q of [
      'How do I back up my seed phrase forever?',
      'Where should I store 2FA backup codes?',
      'What happens if I lose my YubiKey?',
      'Can CryoShield read my secrets?',
      'What if CryoShield disappears?',
    ]) expect(questions).toContain(q);
    for (const d of doc.querySelectorAll('#faq details')) {
      expect(d.querySelector(':scope > summary')).not.toBeNull();
      expect(d.querySelectorAll(':scope > p')).toHaveLength(1);
    }
    expect(doc.querySelector('#faq-lose > summary')?.textContent).toBe('What happens if I lose my YubiKey?');
  });

  it('title and description name the keywords within the limits', () => {
    const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(doc.title.length).toBeLessThanOrEqual(60);
    expect(doc.title).toMatch(/Backup/);
    expect(doc.title).toMatch(/Seed Phrase/i);
    expect(doc.title).toMatch(/2FA/);
    expect(desc.length).toBeGreaterThanOrEqual(150);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc).toMatch(/seed phrase/i);
    expect(desc).toMatch(/2FA backup codes/);
  });

  it('the hero and the final call to action carry the main keywords in visible text', () => {
    const hero = (doc.querySelector('#hero')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(hero).toMatch(/seed phrase/i);
    expect(hero).toMatch(/2FA backup codes/);
    expect(doc.querySelector('#start h2')?.textContent).toMatch(/seed phrase/);
  });
});

describe('"Where backups leak." breaches tile (add-landing-breaches 1.1)', () => {
  const tile = doc.querySelector('#breaches')!;
  const norm = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const t = norm(tile);

  it('is a plain light tile right after the fragile scene, not a pinned scene', () => {
    expect(tile).not.toBeNull();
    expect(tile.previousElementSibling?.id).toBe('fragile');
    expect(tile.nextElementSibling?.id).toBe('how');
    expect(tile.hasAttribute('data-scene')).toBe(false);
    expect(tile.classList.contains('tile')).toBe(true);
    expect(tile.classList.contains('tile-parchment')).toBe(true);
    expect(tile.getAttribute('aria-labelledby')).toBe(tile.querySelector('h2')?.id);
    expect(norm(tile.querySelector('.tile-lead'))).toBe('Seed phrases often leak from the places people keep them.');
  });

  it('has three incident cards with a label, the incident, a distinct helps line and a named source', () => {
    const cards = [...tile.querySelectorAll('.breach-card')];
    expect(cards).toHaveLength(3);
    const got = cards.map((c) => ({
      label: norm(c.querySelector('h3')),
      incident: norm(c.querySelector('.breach-incident')),
      helps: norm(c.querySelector('.breach-helps')),
      source: norm(c.querySelector('a.breach-source')),
      href: c.querySelector('a.breach-source')?.getAttribute('href'),
    }));
    expect(got).toEqual([
      {
        label: "A password manager's cloud",
        incident: 'LastPass, 2022. Attackers stole encrypted vault backups and are believed to have kept cracking weak master passwords offline for years. Blockchain analysts at TRM Labs estimate over $35 million in crypto thefts traced to it through 2025.',
        helps: 'CryoShield has no master password to crack. Your vault key comes from a secret inside your security key that never leaves it.',
        source: 'Source: BleepingComputer',
        href: BREACH_SOURCES[0].href,
      },
      {
        label: 'A screenshot in your photos',
        incident: 'SparkCat, 2025. Apps on the App Store and Google Play scanned photo galleries with text recognition, hunting for seed phrase screenshots.',
        helps: 'CryoShield seals your phrase in your browser. Opening it takes a tap on your physical key.',
        source: 'Source: Kaspersky',
        href: BREACH_SOURCES[1].href,
      },
      {
        label: "A wallet app's logs",
        incident: 'Slope, 2022. Security researchers reported that a wallet app sent seed phrases, unencrypted, to its error-logging server, in a breach that hit nearly 8,000 Solana wallets.',
        helps: 'CryoShield encrypts before anything is stored or sent, and the code is open source, so anyone can check.',
        source: 'Source: The Block',
        href: BREACH_SOURCES[2].href,
      },
    ]);
    for (const c of cards) {
      const icon = c.querySelector('.breach-helps svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('focusable')).toBe('false');
      const a = c.querySelector('a.breach-source')!;
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('target')).toBeNull();
      expect(a.hasAttribute('aria-label')).toBe(false); // the visible text is the accessible name
    }
  });

  it('states the honest limit under the cards', () => {
    const limit = tile.querySelector('.breach-limit');
    expect(norm(limit)).toBe('One honest limit: no backup can protect a phrase typed on a device that is already infected.');
    expect(limit?.compareDocumentPosition(tile.querySelector('.breach-grid')!)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('ends with the call to action and its two pills', () => {
    expect(norm(tile.querySelector('h3.breach-cta-title'))).toBe('Take your seed phrase out of the cloud.');
    const pills = [...tile.querySelectorAll('a.pill')].map((a) => [norm(a), a.getAttribute('href'), a.classList.contains('pill-primary')]);
    expect(pills).toEqual([
      ['Seal it with your security key', '/app/', true],
      ['Read the code', REPO, false],
    ]);
    expect(tile.querySelector(`a.pill[href="${REPO}"]`)?.getAttribute('rel')).toBe('noopener noreferrer');
    // ECC review: the call to action carries the same network caveat as the final CTA (chain-driven: launch-op-mainnet 4.2).
    const caveat = tile.querySelector('.breach-cta .fine');
    expect(norm(caveat)).toBe('Testnet preview on OP Sepolia, not independently audited. Please keep your existing backups too.');
    expect(caveat?.compareDocumentPosition(tile.querySelector('.breach-cta .ctas')!)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('makes no banned or general anti-hacking claim', () => {
    for (const b of BANNED) expect(t, String(b)).not.toMatch(b);
    expect(t).not.toMatch(/\b(prevents?|stops?|blocks?) (all )?(hacks?|hackers|attacks?|malware)\b/i);
    expect(t).not.toMatch(/can(no|')t be (hacked|stolen)/i);
  });
});
