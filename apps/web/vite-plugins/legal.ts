/**
 * Legal pages (add-privacy-and-compliance D6, task 3.1/3.2): the source text lives in apps/web/legal/*.md (public
 * history); at build time it is rendered into static HTML shells (privacy/, terms/, cookies/). No JS, no third-party
 * resources. A deliberately small Markdown subset, so no new dependency: headings, paragraphs, lists, tables,
 * blockquotes, **bold**, `code`, [links](url). Everything is HTML-escaped; placeholders like [ENTITY] are highlighted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLACEHOLDERS = ['[ENTITY]', '[REGISTERED ADDRESS]', '[GRIEVANCE OFFICER]', '[CONTACT EMAIL]'] as const;
export const DRAFT_BANNER = 'Draft, pending legal review';

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
      for (const ph of PLACEHOLDERS) s = s.split(esc(ph)).join(`<mark class="placeholder">${esc(ph)}</mark>`);
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
    if (/^<!--.*-->$/.test(line.trim())) {
      flush();
      out.push(line.trim()); // build-time markers only (e.g. the storage inventory table)
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

export interface StorageInventory {
  routes: Record<string, { cookies: string[]; localStorage: string[]; sessionStorage: string[]; indexedDB: string[]; cacheStorage: string[]; serviceWorkers: string[] }>;
  thirdParty: { who: string; route: string; entries: string[]; note: string }[];
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

export function renderLegalPage(root: string, name: string): string {
  const md = readFileSync(join(root, 'legal', `${name}.md`), 'utf8');
  let html = renderMarkdown(md);
  if (html.includes('<!--storage-inventory-->')) {
    const inv = JSON.parse(readFileSync(join(root, 'legal', 'storage-inventory.json'), 'utf8')) as StorageInventory;
    html = html.replace('<!--storage-inventory-->', inventoryTable(inv));
  }
  return html;
}

/** Shared site header/footer partials (landing visual language) injected into legal shells. */
export function partial(root: string, name: 'header' | 'footer'): string {
  return readFileSync(join(root, 'legal', 'partials', `${name}.html`), 'utf8');
}
