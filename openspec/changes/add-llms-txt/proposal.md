# Proposal

## Why

The founder: "add robots.txt, llms.txt etc. required for better SEO results." `robots.txt`, `sitemap.xml`,
`.well-known/security.txt`, canonical links, share cards and JSON-LD already ship (change `improve-landing-seo`). The
gap is `llms.txt` (https://llmstxt.org): a short Markdown index that AI assistants and answer engines read to learn
what a site is and which pages matter. Without it they guess from the landing page's markup, which is mostly
animated scenes.

## What Changes

- **`/llms.txt`, generated at build time** by `vite-plugins/seo.ts`, in the llmstxt.org format:
  - `# CryoShield`, then a `>` summary that is the landing page's meta description;
  - a short status paragraph (testnet preview on OP Sepolia, test networks can be reset, not independently audited,
    no company behind it);
  - `## Pages`: one link per public page (canonical URL, title, meta description), read from each page's source
    HTML, so it can't drift from the pages;
  - `## Source and specification`: the repository, the vault format spec, the system design, and the recovery tool;
  - `## Optional`: `security.txt` and the sitemap.
  - It never lists `/app/` (noindex) and passes the landing page's honesty denylist.
- **`robots.txt`:** unchanged rules; one comment line pointing to `/llms.txt`.
- **`verify-build`:** fails if `llms.txt` is missing, lacks a public page, or mentions `/app/`.
- **E2E and container tests:** `/llms.txt` is served with `200` and a `text/plain` type.

No runtime change, no new origin, the CSP is unchanged. The development site keeps its `X-Robots-Tag: noindex,
nofollow` header on every response, including `/llms.txt`.

## Impact

- Spec: `landing-page` ("Crawl files" modified).
- Code: `apps/web/vite-plugins/seo.ts`, `apps/web/public/robots.txt`, `apps/web/scripts/verify-build.mjs`, tests.
