# Proposal

## Why

The founder wants the system map (architecture and trust boundaries, key derivation, the create and unlock flows, the
delivery pipeline, and the live reference values) available on the site, so anyone can see how CryoShield works and
what it runs. Today it exists only as a standalone artifact and as `docs/system-design.md`.

## What Changes

- **New page:** a static page at `/architecture` ("System design"), structured like the legal pages: landing visual
  language, the same nav and footer, no JavaScript, and the app CSP. It has:
  - three hand-drawn inline SVG figures (architecture/trust boundaries, key derivation, the delivery pipeline), with
    `role="img"`, `aria-label` and `figcaption`;
  - the create/unlock step lists;
  - a reference-values table.
- **CSP-clean port:** the artifact's `<style>` moves into the site's CSS on our tokens. There are no `style=""`
  attributes. SVG `var(--…)` fills become classes, and arrow-marker ids are unique. Light and dark both work. Wide
  figures scroll inside a keyboard-focusable container on phones, so the page never scrolls sideways.
- **Live values rendered at build time:** the chain ID, network name, VaultRegistry address and deploy block come from
  `contracts/deployments/<VITE_CHAIN_ID>.json`, and the RP ID comes from the config. A freshness test checks the built
  page against those files.
- **Links:** from the landing footer ("System design"), the "How it works" scene, the legal-page header, and the
  `/app/` footer.
- **Serving:** Caddy serves `/architecture` with the same headers and caching as the legal pages (clean URL, exact
  path, no fallback), with container route tests. There is no analytics on the page.
- **Copy updates from the artifact:** the source is now public, and the date line uses the build's network.

**Out of scope:** changing `docs/system-design.md`; any new figure; analytics.

**Runtime dependencies:** none. No new origin.

## Capabilities

### New Capabilities
- `architecture-page`: the public system-design page. Covers its content and accessibility, the CSP-clean figures,
  build-time live values with a freshness guard, routing and headers, and links.

### Modified Capabilities
None.

## Impact

- New files: `apps/web/architecture/index.html` and `apps/web/src/architecture/architecture.css`.
- Changed files:
  - `vite.config.ts` (input);
  - `vite-plugins/{legal-plugin,cryoshield}.ts` (partial name, value tokens, preview rewrite);
  - `deploy/gen-context.mjs`;
  - `scripts/verify-build.mjs`;
  - `index.html` and the legal header partial (links);
  - `src/ui/chrome.tsx` (app footer link).
- Tests: build, E2E (light/dark axe, 390 px), container. Screenshots are added.
