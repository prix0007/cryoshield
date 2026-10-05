/**
 * improve-landing-seo: search metadata for the public pages, the landing page's JSON-LD and the sitemap.
 *  - Titles and descriptions live in each page's HTML (D1); this plugin validates them and derives the canonical link,
 *    the Open Graph tags and the Twitter card tags. A public page without them, or out of the length limits, fails
 *    the build.
 *  - The canonical origin is the constant production origin, not the build's RP ID (D2): a copy served elsewhere
 *    (the dev site) still points search engines at https://cryoshield.app.
 *  - The landing page's FAQPage JSON-LD is generated from the visible FAQ markup (D5), so the two can't drift. The
 *    block is a non-executed data block that scripts/csp-check.mjs `stripJsonLd` accepts (D6): "<" is escaped.
 *  - /app/ must stay noindex (D10).
 */
import type { Plugin } from 'vite';

export const SITE = 'https://cryoshield.app';
const REPO = 'https://github.com/prix0007/cryoshield';

/** The public pages, in sitemap order: built HTML path -> canonical clean path. */
export const PUBLIC_PAGES: readonly { html: string; path: string }[] = [
  { html: '/index.html', path: '/' },
  { html: '/architecture/index.html', path: '/architecture' },
  { html: '/devices/index.html', path: '/devices' },
  { html: '/support/index.html', path: '/support' },
  { html: '/privacy/index.html', path: '/privacy' },
  { html: '/terms/index.html', path: '/terms' },
  { html: '/cookies/index.html', path: '/cookies' },
];
/** Pages that are the application, not content. */
export const NOINDEX_PAGES: readonly string[] = ['/app/index.html'];

export const OG_IMAGE = {
  path: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'CryoShield: seed phrase backups that outlive the drive. Testnet preview.',
} as const;

export const LIMITS = { title: 60, descriptionMin: 150, descriptionMax: 160 } as const;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Plain text only: any '<' or '>' left after decoding entities is dropped, so the result can never form markup.
const text = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

const isNoindex = (html: string) => /<meta name="robots" content="[^"]*\bnoindex\b[^"]*"\s*\/?>/i.test(html);

/** The page's title and description as plain text; throws (failing the build) if missing or out of limits. */
export function pageMeta(html: string, page: string): { title: string; description: string } {
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
  if (titles.length !== 1) throw new Error(`[seo] ${page}: expected exactly one <title>`);
  const descs = [...html.matchAll(/<meta name="description" content="([^"]*)"\s*\/?>/g)];
  if (descs.length !== 1) throw new Error(`[seo] ${page}: expected exactly one <meta name="description">`);
  const title = text(titles[0]![1]!);
  const description = decode(descs[0]![1]!).trim();
  if (!title || title.length > LIMITS.title) throw new Error(`[seo] ${page}: title is ${title.length} characters; it must be 1-${LIMITS.title}`);
  if (description.length < LIMITS.descriptionMin || description.length > LIMITS.descriptionMax) {
    throw new Error(`[seo] ${page}: description is ${description.length} characters; it must be ${LIMITS.descriptionMin}-${LIMITS.descriptionMax}`);
  }
  return { title, description };
}

/** canonical + Open Graph + Twitter card tags. */
export function headTags(meta: { title: string; description: string }, url: string): string {
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description);
  const img = `${SITE}${OG_IMAGE.path}`;
  const alt = escapeAttr(OG_IMAGE.alt);
  return [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="CryoShield">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
  ].join('\n    ');
}

/** The visible FAQ: each <details> of #faq -> its <summary> text and its answer <p> text. */
export function extractFaq(html: string): { question: string; answer: string }[] {
  const section = html.match(/<section id="faq"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  if (!section) return [];
  return [...section.matchAll(/<details\b[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map((m) => ({
    question: text(m[1]!),
    answer: text(m[2]!),
  }));
}

export function landingJsonLd(meta: { description: string }, faq: { question: string; answer: string }[]): object {
  const org = `${SITE}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'CryoShield',
        url: `${SITE}/`,
        logo: `${SITE}/icon-512.png`,
        description: 'CryoShield is an open-source project, maintained by its contributors on GitHub. There is no company behind it.',
        sameAs: [REPO],
      },
      {
        '@type': 'SoftwareApplication',
        name: 'CryoShield',
        url: `${SITE}/`,
        description: meta.description,
        applicationCategory: 'SecurityApplication',
        operatingSystem: 'Any (web browser)',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: `${REPO}/blob/main/LICENSE`,
        image: `${SITE}${OG_IMAGE.path}`,
        publisher: { '@id': org },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      },
    ],
  };
}

/** A data block that can't close early: every "<" is escaped (JSON.parse restores it). */
export const jsonLdScript = (data: object) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/** Adds the SEO head of a built page (`page` is Vite's ctx.path, e.g. '/architecture/index.html'). */
export function transformSeo(html: string, page: string): string {
  if (NOINDEX_PAGES.includes(page)) {
    if (!isNoindex(html)) throw new Error(`[seo] ${page}: the app must carry <meta name="robots" content="noindex">`);
    return html;
  }
  const pub = PUBLIC_PAGES.find((p) => p.html === page);
  if (!pub) throw new Error(`[seo] ${page} is not classified: add it to PUBLIC_PAGES or NOINDEX_PAGES in vite-plugins/seo.ts`);
  if (isNoindex(html)) throw new Error(`[seo] ${page}: a public page must not be noindex`);
  const meta = pageMeta(html, page);
  let tags = headTags(meta, `${SITE}${pub.path}`);
  if (pub.path === '/') {
    const faq = extractFaq(html);
    if (faq.length === 0) throw new Error(`[seo] ${page}: no visible FAQ found for the FAQPage JSON-LD`);
    tags += `\n    ${jsonLdScript(landingJsonLd(meta, faq))}`;
  }
  if (!html.includes('</head>')) throw new Error(`[seo] ${page}: no </head>`);
  return html.replace(/\s*<\/head>/, `\n    ${tags}\n  </head>`);
}

/** sitemap.xml: the public canonical URLs, no <lastmod> (byte-reproducible builds). */
export function sitemapXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PUBLIC_PAGES.map((p) => `  <url><loc>${SITE}${p.path}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

export function seoPlugin(): Plugin {
  return {
    name: 'cryoshield-seo',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = ctx.path.endsWith('/') ? `${ctx.path}index.html` : ctx.path;
        // The dev server may serve other paths; the production build must classify every page.
        if (ctx.server && !NOINDEX_PAGES.includes(page) && !PUBLIC_PAGES.some((p) => p.html === page)) return html;
        return transformSeo(html, page);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
    },
  };
}
