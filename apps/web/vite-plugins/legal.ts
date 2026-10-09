/**
 * Legal pages (add-privacy-and-compliance D6, task 3.1/3.2): the source text lives in apps/web/legal/*.md (public
 * history); at build time it is rendered into static HTML shells (privacy/, terms/, cookies/). No JS, no third-party
 * resources. A deliberately small Markdown subset, so no new dependency: headings, paragraphs, lists, tables,
 * blockquotes, **bold**, `code`, [links](url). Everything is HTML-escaped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** adopt-oss-project-defaults D3: shown under each effective date (marker `<!--legal-note-->` in the source). */
export const LEGAL_NOTE =
  '<p class="legal-note">Written for an open-source project; not legal advice. Suggestions welcome via <a href="https://github.com/prix0007/cryoshield/issues" rel="noopener noreferrer">GitHub</a>.</p>';

/** The only raw lines the renderer emits: build-time markers, replaced after rendering (legal note, inventory tables). */
export const LEGAL_MARKERS: ReadonlySet<string> = new Set(['<!--legal-note-->', '<!--storage-inventory-->', '<!--storage-preferences-->']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(raw: string): string {
  // Tokenise code spans first so their content is not formatted.
  const parts = raw.split(/(`[^`]+`)/g);
  return parts
    .map((p) => {
      if (/^`[^`]+`$/.test(p)) return `<code>${esc(p.slice(1, -1))}</code>`;
      let s = esc(p);
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
        const url = href.replace(/&amp;/g, '&');
        if (!/^(https:\/\/|\/|#|mailto:)/.test(url)) throw new Error(`legal: refusing link target ${url}`);
        const ext = url.startsWith('https://');
        return `<a href="${esc(url)}"${ext ? ' rel="noopener noreferrer"' : ''}>${text}</a>`;
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      return s;
    })
    .join('');
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1]!.length;
      const text = inline(h[2]!.trim());
      out.push(`<h${level} id="${slug(text)}">${text}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      flush();
      i++;
      continue;
    }
    if (line.trim().startsWith('<!--')) {
      // Build-time markers only, matched EXACTLY (harden-codeql-web-findings, CodeQL #4): any other comment-looking
      // line could carry raw HTML past the escaping, so it fails the build instead of being copied into the page.
      const marker = line.trim();
      if (!LEGAL_MARKERS.has(marker)) throw new Error(`legal: refusing unknown marker line ${JSON.stringify(marker.slice(0, 60))}`);
      flush();
      out.push(marker);
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      const [head, sep, ...body] = rows;
      if (!head || !sep || !sep.every((c) => /^:?-{3,}:?$/.test(c))) throw new Error('legal: malformed table');
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const list = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (list) {
      flush();
      const ordered = /\d+\./.test(list[2]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          items.push(m[2]!);
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ' ' + lines[i]!.trim();
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<div class="summary-box">${renderMarkdown(q.join('\n'))}</div>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

export interface StoragePreference {
  key: string;
  storage: string;
  values: string[];
  where: string;
  purpose: string;
  saved: string;
  lifetime: string;
}

export interface StorageInventory {
  routes: Record<string, { cookies: string[]; localStorage: string[]; sessionStorage: string[]; indexedDB: string[]; cacheStorage: string[]; serviceWorkers: string[] }>;
  preferences?: StoragePreference[];
  thirdParty: { who: string; route: string; entries: string[]; note: string }[];
}

/** add-theme-switch D5: the preferences stored only when the visitor chooses them (the theme), on /cookies. */
export function preferencesTable(inv: StorageInventory): string {
  const rows = (inv.preferences ?? [])
    .map(
      (p) =>
        `<tr><th scope="row"><code>${esc(p.key)}</code></th><td>${esc(p.storage)}</td><td>${p.values.map((v) => `<code>${esc(v)}</code>`).join(' or ')}</td><td>${esc(p.where)}. ${esc(p.purpose)}</td><td>${esc(p.saved)}</td><td>${esc(p.lifetime)}</td></tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table class="inventory" data-testid="storage-preferences"><thead><tr><th scope="col">Name</th><th scope="col">Where</th><th scope="col">Value</th><th scope="col">What it is for</th><th scope="col">When it is saved</th><th scope="col">How long it stays</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The device-storage inventory table on /cookies, generated from legal/storage-inventory.json (single source). */
export function inventoryTable(inv: StorageInventory): string {
  const cell = (v: string[]) => (v.length ? v.map((x) => `<code>${esc(x)}</code>`).join(', ') : 'None');
  const rows = Object.entries(inv.routes)
    .map(
      ([route, r]) =>
        `<tr><th scope="row"><code>${esc(route)}</code></th><td>${cell(r.cookies)}</td><td>${cell(r.localStorage)}</td><td>${cell(r.sessionStorage)}</td><td>${cell(r.indexedDB)}</td><td>${cell(r.cacheStorage)}</td><td>${cell(r.serviceWorkers)}</td></tr>`,
    )
    .join('');
  const tp = inv.thirdParty
    .map((t) => `<tr><th scope="row">${esc(t.who)} (<code>${esc(t.route)}</code>)</th><td colspan="6">${t.entries.length ? cell(t.entries) : 'None'}. ${esc(t.note)}</td></tr>`)
    .join('');
  return `<div class="table-wrap"><table class="inventory" data-testid="storage-inventory"><thead><tr><th scope="col">Route</th><th scope="col">Cookies</th><th scope="col">localStorage</th><th scope="col">sessionStorage</th><th scope="col">IndexedDB</th><th scope="col">Cache Storage</th><th scope="col">Service workers</th></tr></thead><tbody>${rows}${tp}</tbody></table></div>`;
}

/** `network` resolves the launch-op-mainnet network blocks for the build's chain (vite-plugins/network-copy.ts). */
export function renderLegalPage(root: string, name: string, network: (md: string) => string): string {
  const md = network(readFileSync(join(root, 'legal', `${name}.md`), 'utf8'));
  let html = renderMarkdown(md).replace('<!--legal-note-->', LEGAL_NOTE);
  if (html.includes('<!--storage-inventory-->') || html.includes('<!--storage-preferences-->')) {
    const inv = JSON.parse(readFileSync(join(root, 'legal', 'storage-inventory.json'), 'utf8')) as StorageInventory;
    html = html.replace('<!--storage-inventory-->', () => inventoryTable(inv)).replace('<!--storage-preferences-->', () => preferencesTable(inv));
  }
  return html;
}

/**
 * add-supported-devices-page: renders docs/<name>.md from the repository root with the same escaped renderer and
 * link allowlist as the legal pages. The same file is what GitHub shows in the repo.
 */
export function renderRepoDoc(root: string, name: 'supported-devices'): string {
  return renderMarkdown(readFileSync(join(root, '..', '..', 'docs', `${name}.md`), 'utf8'));
}

/** Shared site header/footer partials (landing visual language) injected into legal shells. */
export function partial(root: string, name: 'header' | 'footer'): string {
  return readFileSync(join(root, 'legal', 'partials', `${name}.html`), 'utf8');
}
