#!/usr/bin/env node
// Issue triage helpers (OpenSpec change add-issue-triage). Pure functions plus a small CLI used by
// .github/workflows/issue-triage.yml. Nothing here ever prints matched secret text: results are verdicts and
// reason CODES only.
//
//   triage.mjs screen <file> [--gitleaks-exit N] [--labels-json '[..]']   -> {"verdict","reasons"}  (exit 2 on error)
//   triage.mjs guard <file>            (env TRIAGE_TOKEN: exact token to refuse)  -> exit 0 ok / 1 refused (codes only)
//   triage.mjs labels <file>           -> allow-listed labels, one per line
//   triage.mjs caps --markers-file <json> --now <iso> --author <login> [--author-is-owner true] [--owner-rerun true] [--daily-cap 20]
//   triage.mjs compose --diagnosis <file> [--previous <file>] --now <iso> --author <login>   -> comment body
//   triage.mjs prepare --issue <json> --comments <json> --out <dir>  -> issue.md, comments.md (exit 3: no longer passes)
//   triage.mjs text <ack|sensitive|security|queued|privacy>  -> fixed comment text
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// Wordlist: bitcoin/bips bip-0039/english.txt, 2048 words, pinned by SHA-256 (design decision 2).
export const WORDLIST_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
const DEFAULT_WORDLIST = new URL('./data/bip39-english.txt', import.meta.url);
let WORDS;
export function loadWordlist(path = DEFAULT_WORDLIST) {
  const raw = readFileSync(path);
  const hash = createHash('sha256').update(raw).digest('hex');
  if (hash !== WORDLIST_SHA256) throw new Error(`BIP39 wordlist hash mismatch (${hash}); refusing to screen (fail closed)`);
  const set = new Set(raw.toString('utf8').split('\n').map((w) => w.trim()).filter(Boolean));
  if (set.size !== 2048) throw new Error('BIP39 wordlist must have 2048 words');
  return set;
}
const words = () => (WORDS ??= loadWordlist());

// ---------------------------------------------------------------------------------------------------------------
export const MARKERS = {
  ack: '<!-- cryoshield-triage-ack -->',
  triage: '<!-- cryoshield-triage -->',
  sensitive: '<!-- cryoshield-triage-sensitive -->',
  security: '<!-- cryoshield-triage-security -->',
  queued: '<!-- cryoshield-triage-queued -->',
  privacy: '<!-- cryoshield-triage-privacy -->',
};
const NEVER = '**Never post seed phrases, recovery codes, PINs or keys** — CryoShield maintainers will never ask for them.';
export const TEXTS = {
  ack: `${MARKERS.ack}\nThanks for opening this issue! An automated first look will follow shortly, and a maintainer will review it.\n\n${NEVER}`,
  sensitive: `${MARKERS.sensitive}\n⚠️ **This issue appears to contain secret material** (for example a seed or recovery phrase, a private key, or a 2FA secret). This comment does not repeat it, and no automated analysis was run.\n\n1. **Remove it now** by editing the issue. GitHub keeps an edit history that others can read, so a maintainer will delete this issue; please open a new one without the secret.\n2. **Treat it as compromised.** If it was a wallet seed phrase or private key, move any funds to a new wallet created with a new seed phrase now. If it was a 2FA secret, backup code or recovery code, regenerate it with that service.\n\n${NEVER} If you need to share a transaction, post a block-explorer link instead of a bare hash.`,
  security: `${MARKERS.security}\n🔒 **This looks like it may be a security vulnerability report.** To protect users, please report vulnerabilities privately: https://github.com/prix0007/cryoshield/security/advisories/new (see SECURITY.md). If this issue contains exploit details, please edit them out.\n\nNo automated analysis was run. A maintainer will review this issue; if it is not a vulnerability, they will remove the label and triage it normally.`,
  queued: `${MARKERS.queued}\nAutomatic triage is at capacity right now, so this issue is **queued for maintainer review**. Thanks for your patience.`,
  privacy: `${MARKERS.privacy}\nThis is a privacy request, so it is handled by a maintainer directly (no automated analysis). See https://cryoshield.app/privacy for timelines.`,
};

export const ALLOWED_LABELS = ['bug', 'enhancement', 'question', 'docs', 'needs-repro', 'web', 'contracts', 'crypto', 'recovery-tool', 'ci', 'duplicate?', 'good first issue'];
const MAX_LABELS = 5;

// ---------------------------------------------------------------------------------------------------------------
// Sensitive-content detectors. Each returns a reason code or null; none returns the matched text.
const B58 = '1-9A-HJ-NP-Za-km-z';
const withoutUrls = (t) => t.replace(/https?:\/\/[^\s)<>\]]+/gi, ' ');

function hasBip39Run(text, min = 12) {
  const set = words();
  let run = 0;
  for (const token of text.toLowerCase().split(/[^a-z]+/)) {
    if (!token) continue;
    run = set.has(token) ? run + 1 : 0;
    if (run >= min) return true;
  }
  return false;
}

const DETECTORS = [
  ['bip39', (t) => hasBip39Run(t)],
  ['hex64', (t) => /(^|[^0-9A-Fa-f])(0x)?[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/.test(withoutUrls(t))],
  ['extended-key', (t) => new RegExp(`(^|[^${B58}])[xyztuv](prv|pub)[${B58}]{100,108}(?![${B58}])`).test(t)],
  ['wif', (t) => new RegExp(`(^|[^${B58}])(5[HJK][${B58}]{49}|[KLc][${B58}]{51})(?![${B58}])`).test(t)],
  ['totp', (t) =>
    /otpauth:\/\//i.test(t) ||
    /secret=[A-Z2-7]{16,}/i.test(t) ||
    t.split(/\r?\n/).some((line) => /\b(totp|2fa|mfa|authenticator|backup codes?|recovery codes?)\b/i.test(line) &&
      (/(^|[^A-Z2-7])[A-Z2-7]{16,}(?![A-Z2-7])/.test(line) || /\b[a-z0-9]{4}-[a-z0-9]{4}\b/i.test(line)))],
];

const SECURITY_PATTERNS = [
  /\bvulnerab\w*/i, /\bexploit\w*/i, /\bCVE-\d{4}-\d+/i, /\bsecurity (issue|bug|flaw|hole|problem|report)\b/i, /\bXSS\b/i, /\bCSRF\b/i,
  /\bRCE\b/i, /\bremote code execution\b/i, /\bprivilege escalation\b/i, /\bbypass\w*/i, /\binjection\b/i, /\b(0|zero)-?day\b/i,
  /\bdrain\w*/i, /\bsteal\w*/i, /\bexfiltrat\w*/i, /\bphishing\b/i, /\battacker\b/i,
];

export function screen(text, { gitleaksExit = 0, labels = [] } = {}) {
  const t = String(text ?? '');
  if (![0, 1].includes(Number(gitleaksExit))) throw new Error(`gitleaks exited ${gitleaksExit}; refusing to continue (fail closed)`);
  const reasons = DETECTORS.filter(([, f]) => f(t)).map(([code]) => code);
  if (Number(gitleaksExit) === 1) reasons.push('gitleaks');
  if (reasons.length) return { verdict: 'sensitive', reasons };
  if (SECURITY_PATTERNS.some((re) => re.test(t))) return { verdict: 'security', reasons: ['keywords'] };
  if (labels.map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase()).includes('privacy-request')) return { verdict: 'privacy', reasons: ['label'] };
  return { verdict: 'ok', reasons: [] };
}

// ---------------------------------------------------------------------------------------------------------------
const CREDENTIAL_SHAPES = [
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{10,}/], ['github-token', /gh[pousr]_[A-Za-z0-9]{20,}/], ['github-pat', /github_pat_[A-Za-z0-9_]{20,}/],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
export function guard(text, { token } = {}) {
  const t = String(text ?? '');
  const reasons = [
    ...CREDENTIAL_SHAPES.filter(([, re]) => re.test(t)).map(([c]) => c),
    ...(token && token.length >= 8 && t.includes(token) ? ['exact-token'] : []),
    ...DETECTORS.filter(([, f]) => f(t)).map(([c]) => c),
  ];
  return { ok: reasons.length === 0, reasons };
}

export function filterLabels(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/[,\n]/)) {
    const l = raw.trim().toLowerCase();
    if (ALLOWED_LABELS.includes(l) && !out.includes(l)) out.push(l);
  }
  return out.slice(0, MAX_LABELS);
}

// ---------------------------------------------------------------------------------------------------------------
// Caps (design decision 5). Markers come only from github-actions[bot] comments that start with the triage marker.
const BOT = 'github-actions[bot]';
const RUN_RE = /<!-- cryoshield-triage-run: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) author=([A-Za-z0-9-]{1,39}(?:\[bot\])?) -->/g;
export function parseMarkers(comments) {
  const out = [];
  for (const c of comments ?? []) {
    if (c?.author !== BOT || !String(c.body ?? '').startsWith(MARKERS.triage)) continue;
    for (const m of String(c.body).matchAll(RUN_RE)) {
      const time = new Date(m[1]);
      if (!Number.isNaN(time.getTime())) out.push({ time, author: m[2] });
    }
  }
  return out;
}

export function evaluateCaps({ now, markers, issueAuthor, issueAuthorIsOwner = false, ownerRerun = false, dailyCap = 20 }) {
  if (ownerRerun) return { allowed: true, reason: null };
  const day = now.toISOString().slice(0, 10);
  if (markers.filter((m) => m.time.toISOString().slice(0, 10) === day).length >= dailyCap) return { allowed: false, reason: 'daily' };
  if (!issueAuthorIsOwner) {
    const hourAgo = now.getTime() - 3600_000;
    if (markers.some((m) => m.author === issueAuthor && m.time.getTime() > hourAgo && m.time.getTime() <= now.getTime())) {
      return { allowed: false, reason: 'author' };
    }
  }
  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------------------------------------------
const FOOTER = '<sub>Automated first look by the CryoShield triage agent: model output, it may be wrong. A maintainer will follow up. ' +
  'Never post seed phrases, recovery codes, PINs or keys.</sub>';
export function composeComment({ diagnosis, previous, now, author }) {
  if (!/^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(String(author))) throw new Error('invalid author login');
  // The agent cannot forge markers: every HTML comment in its text is removed.
  const text = String(diagnosis ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '').trim();
  const prior = previous ? [...String(previous).matchAll(RUN_RE)].map((m) => m[0]) : [];
  const run = `<!-- cryoshield-triage-run: ${now.toISOString()} author=${author} -->`;
  return `${MARKERS.triage}\n${text}\n\n---\n${FOOTER}\n${[...prior, run].join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnose-job input: the issue is screened AGAIN (it may have been edited since the screen job); comments are
// screened one by one and withheld if sensitive or vulnerability-like; our own bot comments are dropped.
export function prepare(issue, comments) {
  const title = String(issue?.title ?? '');
  const body = String(issue?.body ?? '');
  const v = screen(`${title}\n\n${body}`);
  if (v.verdict !== 'ok') return { ok: false, verdict: v.verdict };
  const labels = (issue?.labels ?? []).map(String).join(', ') || '(none)';
  const issueMd = `# ${title}\n\nLabels: ${labels}\nAuthor association: ${String(issue?.authorAssociation ?? 'NONE')}\n\n${body}\n`;
  const parts = [];
  for (const c of comments ?? []) {
    if (c?.author === BOT) continue;
    const s = screen(String(c?.body ?? ''));
    const text = s.verdict === 'sensitive' ? '[comment withheld by the pre-screen: it may contain secret material]'
      : s.verdict === 'security' ? '[comment withheld by the pre-screen: possible vulnerability details]'
        : String(c?.body ?? '');
    parts.push(`---\n**@${String(c?.author ?? '?')}** (${String(c?.association ?? 'NONE')}):\n\n${text}\n`);
  }
  return { ok: true, issue: issueMd, comments: parts.join('\n') || '(no comments)\n' };
}

// ---------------------------------------------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const read = (p) => readFileSync(p, 'utf8');
  try {
    if (cmd === 'screen') {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { 'gitleaks-exit': { type: 'string', default: '0' }, 'labels-json': { type: 'string', default: '[]' } } });
      const r = screen(read(positionals[0]), { gitleaksExit: Number(values['gitleaks-exit']), labels: JSON.parse(values['labels-json']) });
      process.stdout.write(`${JSON.stringify(r)}\n`);
    } else if (cmd === 'guard') {
      const r = guard(read(rest[0]), { token: process.env.TRIAGE_TOKEN });
      if (!r.ok) {
        console.error(`::error title=triage guard::refusing to post: ${r.reasons.join(', ')}`);
        process.exit(1);
      }
    } else if (cmd === 'labels') {
      const l = filterLabels(existsSync(rest[0]) ? read(rest[0]) : '');
      if (l.length) process.stdout.write(`${l.join('\n')}\n`);
    } else if (cmd === 'caps') {
      const { values } = parseArgs({ args: rest, options: { 'markers-file': { type: 'string' }, now: { type: 'string' }, author: { type: 'string' }, 'author-is-owner': { type: 'string', default: 'false' }, 'owner-rerun': { type: 'string', default: 'false' }, 'daily-cap': { type: 'string', default: '20' } } });
      const markers = parseMarkers(JSON.parse(read(values['markers-file'])));
      const r = evaluateCaps({ now: new Date(values.now), markers, issueAuthor: values.author, issueAuthorIsOwner: values['author-is-owner'] === 'true', ownerRerun: values['owner-rerun'] === 'true', dailyCap: Number(values['daily-cap']) });
      process.stdout.write(`${JSON.stringify(r)}\n`);
    } else if (cmd === 'compose') {
      const { values } = parseArgs({ args: rest, options: { diagnosis: { type: 'string' }, previous: { type: 'string' }, now: { type: 'string' }, author: { type: 'string' } } });
      const previous = values.previous && existsSync(values.previous) ? read(values.previous) : null;
      process.stdout.write(composeComment({ diagnosis: read(values.diagnosis), previous, now: new Date(values.now), author: values.author }));
    } else if (cmd === 'prepare') {
      const { values } = parseArgs({ args: rest, options: { issue: { type: 'string' }, comments: { type: 'string' }, out: { type: 'string' } } });
      const r = prepare(JSON.parse(read(values.issue)), JSON.parse(read(values.comments)));
      if (!r.ok) {
        console.error(`::error title=triage::the issue no longer passes the pre-screen (${r.verdict}); not sending it to the model`);
        process.exit(3);
      }
      writeFileSync(join(values.out, 'issue.md'), r.issue);
      writeFileSync(join(values.out, 'comments.md'), r.comments);
    } else if (cmd === 'text') {
      if (!Object.hasOwn(TEXTS, rest[0] ?? '')) throw new Error(`unknown text ${rest[0]}`);
      process.stdout.write(`${TEXTS[rest[0]]}\n`);
    } else {
      throw new Error(`unknown command ${cmd}`);
    }
  } catch (e) {
    console.error(`triage: ${e.message}`);
    process.exit(2);
  }
}
