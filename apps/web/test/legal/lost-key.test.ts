// @vitest-environment jsdom
/**
 * add-compromised-key-guide: docs/lost-or-compromised-key.md is the single source; it is rendered at build into
 * /lost-key with the legal renderer (escaped, link allowlist), the app CSP and no script. Content rules keep it honest.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../vite-plugins/legal';
import { S } from '../../src/ui/strings';
import { VAULTS as V } from '../../src/ui/strings-vaults';

const web = join(__dirname, '..', '..');
const repo = join(web, '..', '..');
const md = readFileSync(join(repo, 'docs', 'lost-or-compromised-key.md'), 'utf8');
const flat = md.replace(/\s+/g, ' ');

const NUM = String.raw`(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`;
const NEGATED = /\b(can[’']t|cannot|can not|no way|not|never|nobody|nothing|isn[’']t|doesn[’']t|don[’']t)\b/i;
/** Sentences that promise what CryoShield can't do (design D2 "Deliberately not claimed"; spec "Honest about what a key can do"). */
function falseComfort(text: string): string[] {
  const out: string[] = [];
  // Link targets are URLs (e.g. …/cryoshield/tree/main/tools/recover), not claims: only the link text is checked.
  for (const raw of text.replace(/\]\([^)]*\)/g, ']').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
    const s = raw.toLowerCase();
    const negated = NEGATED.test(s);
    if (!negated && /\b(remove|revoke|delete|erase|wipe|unenrol+)\b[^.]{0,40}\b(keys?|versions?|it|them)\b/.test(s)) out.push(`removal or deletion: ${raw}`);
    if (new RegExp(String.raw`\b${NUM}\b[^.]{0,25}\b(wrong|pin|guess(es)?|attempts?|tries)\b|\b(attempts?|tries|guesses)\b[^.]{0,15}\b${NUM}\b`).test(s)) out.push(`PIN count: ${raw}`);
    if (!negated && /cryoshield[^.]{0,30}\b(recover|restore|unlock|reset|retrieve)\b/.test(s)) out.push(`recovery by CryoShield: ${raw}`);
    if (/\b(contact|email|write to|message|reach( out to)?) (us|cryoshield|support|the team)\b/.test(s)) out.push(`contact for recovery: ${raw}`);
  }
  return out;
}

describe('docs/lost-or-compromised-key.md content', () => {
  it('has a "Last reviewed" date that is a real date and not in the future', () => {
    const m = md.match(/\*\*Last reviewed:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    expect(m, 'Last reviewed line').not.toBeNull();
    const d = new Date(`${m![1]}T00:00:00Z`);
    expect(d.toISOString().slice(0, 10)).toBe(m![1]);
    expect(d.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 3600_000);
  });

  it('has every section, and the six steps in order (spec "Two situations and ordered steps")', () => {
    expect([...md.matchAll(/^## (.+)$/gm)].map((x) => x[1])).toEqual([
      'What one key can do',
      'Which situation are you in?',
      'Steps when a key is compromised',
      'If no key you trust can open the vault',
      'What CryoShield can and can’t do',
    ]);
    expect([...md.matchAll(/^### (Step \d)\. (.+)$/gm)].map((x) => `${x[1]}. ${x[2]}`)).toEqual([
      'Step 1. Use a device and a key you trust',
      'Step 2. Change the secrets at their source',
      'Step 3. Create a new vault for the new secrets',
      'Step 4. Archive and clear the old vault',
      'Step 5. Update your backups and notes',
      'Step 6. Reset or retire the compromised key, last',
    ]);
    expect(flat).toContain('When in doubt, follow the steps below.');
  });

  it('is honest about what a key can do and that old versions stay readable (spec "Honest about what a key can do")', () => {
    expect(flat).toContain('It always needs its PIN.');
    expect(flat).toContain('With its PIN, any one key opens your vault.');
    expect(flat).toContain('With its PIN, any one key can also change your vault.');
    // The app's own clear-sheet warnings, verbatim, so the guide never drifts from what the app says.
    expect(md).toContain(`- ${V.clear.points[0]}`);
    expect(md).toContain(`- ${V.clear.points[1]}`);
    expect(flat).toContain('a key cannot be locked out of a vault, and old versions cannot be erased');
    expect(flat).toContain('CryoShield can’t remove a key from a vault, lock a key out, delete old versions, or recover a vault for you.');
  });

  it('promises nothing CryoShield can’t do: no key removal, no deletion, no PIN count, no recovery by CryoShield', () => {
    expect(falseComfort(md)).toEqual([]);
  });

  // ECC review of #87, finding 4: the guard itself catches the wordings a later edit could slip in.
  it('the false-comfort guard catches removal, deletion, PIN-count, recovery and contact promises', () => {
    for (const bad of [
      'Open the vault and you can remove it from the key list.',
      'Then delete old versions of the vault.',
      'Revoke the lost key under Manage vault.',
      'A YubiKey allows up to 8 PIN tries before it locks.',
      'After eight wrong guesses the key locks.',
      'CryoShield can help you recover the vault.',
      'If that fails, contact support with your vault ID.',
    ]) {
      expect(falseComfort(bad), bad).not.toEqual([]);
    }
    // Negated statements are what the guide is for.
    for (const ok of ['CryoShield can’t remove a key from a vault, lock a key out, delete old versions, or recover a vault for you.', 'There is no way to remove it.', 'Nobody, including CryoShield, can delete them.']) {
      expect(falseComfort(ok), ok).toEqual([]);
    }
  });

  it('warns never to share secrets, including with someone claiming to be CryoShield (spec "Safe guidance")', () => {
    expect(flat).toContain('**Never give anyone your seed phrases, recovery codes, PINs or keys, even someone who says they are from CryoShield.**');
  });

  it('names the app’s real controls, so the steps match the screens', () => {
    for (const label of [S.home.create, S.vault.manage, S.vault.editVault, V.clear.open, S.vault.details, S.details.download, S.vault.addKey]) {
      expect(flat, label).toContain(label);
    }
    expect(flat).toContain('A reset erases every credential on the key');
  });

  it('renders with the escaped legal renderer (only allowlisted link schemes)', () => {
    const html = renderMarkdown(md);
    expect(html).toContain('<h1 id="if-a-key-is-lost-or-compromised">If a key is lost or compromised</h1>');
    expect(html).not.toMatch(/<script|javascript:|on\w+=/i);
    for (const id of ['what-one-key-can-do', 'steps-when-a-key-is-compromised']) expect(html).toContain(`id="${id}"`);
  });
});

describe('/lost-key page (built)', () => {
  let out = '';
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'cs-lost-key-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
    execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...env, NODE_ENV: 'production' } });
  }, 180_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const html = (p: string) => readFileSync(join(out, p), 'utf8');
  const doc = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
  const metaCsp = (p: string) => html(p).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];

  it('is emitted at lost-key/index.html with the rendered Markdown, the app CSP, only the theme script and no third-party resource', () => {
    const h = html('lost-key/index.html');
    expect(doc('lost-key/index.html').querySelector('main h1')?.textContent).toBe('If a key is lost or compromised');
    expect(doc('lost-key/index.html').title).toBe('Lost or Compromised Security Key · CryoShield');
    expect([...h.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0])).toEqual([expect.stringMatching(/^<script src="\/assets\/theme-[0-9a-f]{8}\.js">$/)]);
    expect(h).not.toMatch(/cloudflareinsights|cf-beacon/);
    for (const m of h.matchAll(/<(?:link(?! rel="canonical")|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/g)) expect(m[1]).toMatch(/^(\/|data:)/);
    expect(metaCsp('lost-key/index.html')).toBe(metaCsp('app/index.html'));
  });

  it('every static page links "Lost or compromised key" in its footer', () => {
    for (const p of ['index.html', 'privacy/index.html', 'terms/index.html', 'cookies/index.html', 'architecture/index.html', 'devices/index.html', 'support/index.html', 'lost-key/index.html']) {
      const links = [...doc(p).querySelectorAll('footer a')].filter((a) => a.getAttribute('href') === '/lost-key');
      expect(links.map((a) => a.textContent?.trim()), p).toEqual(['Lost or compromised key']);
    }
  });

  it('the landing FAQ "What happens if I lose my YubiKey?" links /lost-key', () => {
    const faq = [...doc('index.html').querySelectorAll('#faq details')].find((d) => d.querySelector('summary')?.textContent === 'What happens if I lose my YubiKey?')!;
    expect([...faq.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/lost-key');
  });
});

// ECC review of #87, finding 7: one list of repo documents drives the type, the marker regex and the shells.
describe('repo documents', () => {
  it('REPO_DOCS lists each rendered document once, and each has a shell with its marker', async () => {
    const { REPO_DOCS, repoDocMarker } = await import('../../vite-plugins/legal');
    expect([...REPO_DOCS]).toEqual(['supported-devices', 'lost-or-compromised-key']);
    for (const [doc, shell] of [['supported-devices', 'devices'], ['lost-or-compromised-key', 'lost-key']] as const) {
      const html = readFileSync(join(web, shell, 'index.html'), 'utf8');
      expect(html.match(repoDocMarker())?.[1], shell).toBe(doc);
    }
    expect('<!--doc:not-a-doc-->').not.toMatch(repoDocMarker());
  });
});
