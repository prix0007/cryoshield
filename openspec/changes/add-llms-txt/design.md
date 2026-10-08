# Design

## D1. Generated, not hand-written

`llms.txt` is emitted by the SEO plugin's `generateBundle` from `PUBLIC_PAGES`. Each page's title and description
come from its source HTML through the existing `pageMeta` (the same validated values used for the canonical, Open
Graph and Twitter tags). Reading the source files, rather than the transformed HTML, keeps the output independent of
plugin hook order and byte-reproducible. A new public page appears in `llms.txt` and the sitemap from one edit.

## D2. Honest copy

The only hand-written prose is a status paragraph in `seo.ts` that restates what the preview banner already says:
testnet (OP Sepolia), test networks can be reset, not independently audited, open source with no company. The
`llms.txt` text is run through the landing page's denylist in tests (no "forever" promises, no availability claims).
When the mainnet launch changes the banner, this paragraph changes with it (the launch change owns that edit).

## D3. Links

Page links are the canonical `https://cryoshield.app/...` URLs, as in the sitemap. Documentation links point to the
GitHub repository's `main` branch: `docs/spec/vault-format-v1.md`, `docs/system-design.md`, `tools/recover`. No
`llms-full.txt`: the public pages are short, and duplicating their text adds a second copy that could drift.

## D4. Serving

Caddy serves `.txt` as `text/plain; charset=utf-8` and adds the same security headers as every other file. The
development host's `X-Robots-Tag: noindex, nofollow` applies to it unchanged; the build emits no development
variant.

## Security review

No crypto, contract, paymaster, secret-handling or CI change. The file is static, built from committed HTML, and
lists only public URLs. N/A beyond the normal ECC review.
