// @vitest-environment jsdom
/**
 * add-supported-devices-page: docs/supported-devices.md is the single source; it is rendered at build into /devices
 * with the legal renderer (escaped, link allowlist), the app CSP and no script. Content rules keep it honest.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../vite-plugins/legal';
import { S } from '../../src/ui/strings';

const web = join(__dirname, '..', '..');
const repo = join(web, '..', '..');
const md = readFileSync(join(repo, 'docs', 'supported-devices.md'), 'utf8');
const STATUSES = ['Tested', 'Expected to work', 'Not supported'];

/** Rows of the Markdown table under a "## <heading>". */
function table(heading: string): string[][] {
  const sec = md.split(/\n## /).find((s) => s.startsWith(heading))!;
  const rows = sec.split('\n').filter((l) => l.startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  return rows.slice(2);
}

describe('docs/supported-devices.md content', () => {
  it('has a "Last reviewed" date that is a real date and not in the future', () => {
    const m = md.match(/\*\*Last reviewed:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    expect(m, 'Last reviewed line').not.toBeNull();
    const d = new Date(`${m![1]}T00:00:00Z`);
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.toISOString().slice(0, 10)).toBe(m![1]); // e.g. 2026-02-30 is rejected
    // Not in the future anywhere on Earth: the date may already have begun in UTC+14.
    expect(d.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 3600_000);
  });

  it('has every required section', () => {
    const h2 = [...md.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
    expect(h2).toEqual(['Requirements a key must meet', 'Why phone and laptop passkeys are refused', 'Keys', 'Browsers', 'Recovery tool requirements', 'How to check your key', 'Report your device']);
  });

  it('lists every key requirement with a reason', () => {
    const rows = table('Requirements a key must meet');
    const text = rows.map((r) => r[0]).join(' ');
    for (const req of ['hmac-secret', 'User verification', 'credProtect level 3', 'Discoverable credentials', 'ES256', 'roaming']) expect(text).toContain(req);
    for (const r of rows) expect(r[1]!.length, r[0]).toBeGreaterThan(20);
    expect(md).toMatch(/free slot/);
  });

  it('every key and browser has exactly one allowed status; "Tested" always carries a date and says what was tested', () => {
    for (const [name, col] of [['Keys', 2], ['Browsers', 2]] as const) {
      for (const r of table(name)) {
        const status = r[col]!.replace(/\*\*/g, '');
        const hits = STATUSES.filter((s) => status.startsWith(s));
        expect(hits, `${name}: ${r[0]}`).toHaveLength(1);
        if (hits[0] === 'Tested') {
          expect(status, r[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
          expect(status, r[0]).toMatch(/\(.+\)/); // which flow was tested
        }
      }
    }
  });

  it('the only "Tested" claim is the YubiKey 5 create flow, and pending checks are stated', () => {
    const tested = table('Keys').filter((r) => r[2]!.includes('Tested'));
    expect(tested.map((r) => r[0])).toEqual([expect.stringMatching(/^YubiKey 5 series/)]);
    expect(tested[0]![3]).toMatch(/before\*\* credProtect level 3/);
    expect(tested[0]![3]).toMatch(/not yet confirmed/);
    for (const r of table('Browsers')) expect(r[2]).not.toMatch(/Tested/);
  });

  it('quotes the app’s real refusal messages verbatim (stays in sync with the UI)', () => {
    expect(md).toContain(`> ${S.keyErrors.PRF_UNSUPPORTED_KEY}`);
    expect(md).toContain(`> ${S.keyErrors.CRED_PROTECT_UNSUPPORTED}`);
  });

  it('explains why platform and synced passkeys are refused, and the recovery tool needs', () => {
    expect(md).toMatch(/CTAP protocol over USB/);
    expect(md).toMatch(/only the hardware you hold/);
    expect(md).toMatch(/USB keys only/);
    expect(md).toMatch(/pyscard/);
    expect(md).toMatch(/Python 3\.10 or newer/);
    expect(md).toMatch(/ykman info/);
  });

  it('links the device-report issue form, which exists, and warns about secrets', () => {
    expect(md).toContain('https://github.com/prix0007/cryoshield/issues/new?template=device-report.yml');
    expect(existsSync(join(repo, '.github', 'ISSUE_TEMPLATE', 'device-report.yml'))).toBe(true);
    expect(md).toContain('**Never post seed phrases, recovery codes, PINs or keys**');
  });

  it('renders with the escaped legal renderer (only allowlisted link schemes)', () => {
    const html = renderMarkdown(md);
    expect(html).toContain('<h1 id="supported-devices">Supported devices</h1>');
    expect(html).not.toMatch(/<script|javascript:|on\w+=/i);
    for (const id of ['how-to-check-your-key', 'report-your-device', 'why-phone-and-laptop-passkeys-are-refused']) expect(html).toContain(`id="${id}"`);
  });
});

describe('/devices page (built)', () => {
  let out = '';
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'cs-devices-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
    execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...env, NODE_ENV: 'production' } });
  }, 180_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const html = (p: string) => readFileSync(join(out, p), 'utf8');
  const doc = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
  const metaCsp = (p: string) => html(p).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];

  it('is emitted at devices/index.html with the rendered Markdown, the app CSP, no script and no third-party resource', () => {
    const h = html('devices/index.html');
    expect(doc('devices/index.html').querySelector('main h1')?.textContent).toBe('Supported devices');
    expect(doc('devices/index.html').title).toBe('YubiKey & Security Keys for Encrypted Backup · CryoShield');
    // add-theme-switch D1: the one same-origin classic theme script, nothing else.
    expect([...h.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0])).toEqual([expect.stringMatching(/^<script src="\/assets\/theme-[0-9a-f]{8}\.js">$/)]);
    expect(h).not.toMatch(/cloudflareinsights|cf-beacon/);
    for (const m of h.matchAll(/<(?:link(?! rel="canonical")|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/g)) expect(m[1]).toMatch(/^(\/|data:)/);
    expect(metaCsp('devices/index.html')).toBe(metaCsp('app/index.html'));
  });

  it('every page links "Supported devices" in its footer', () => {
    for (const p of ['index.html', 'privacy/index.html', 'terms/index.html', 'cookies/index.html', 'architecture/index.html', 'devices/index.html']) {
      const links = [...doc(p).querySelectorAll('footer a')].filter((a) => a.getAttribute('href') === '/devices');
      expect(links.map((a) => a.textContent?.trim()), p).toEqual(['Supported devices']);
    }
  });

  it('the landing FAQ "What do I need?" links /devices', () => {
    const faq = [...doc('index.html').querySelectorAll('#faq details')].find((d) => d.querySelector('summary')?.textContent === 'What do I need?')!;
    expect([...faq.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/devices');
  });
});
