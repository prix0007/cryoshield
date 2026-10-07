# Proposal

## Why

Founder live test, 2026-10-04: a vault was created on OP Sepolia (block 49631323), and the app then said "Extra backup
copy not saved yet. Retry". The overwatcher found three bugs:

1. **Wrong status.** Turbo accepted the upload (HTTP 200) and indexed it on its fast-finality gateway
   (`turbo-gateway.com`). But `ensure()`/`lookup()` only query `arweave.net`, which shows bundled items only after
   settlement, often hours later. So the app reports "not saved" after a successful upload, and every unlock
   re-uploads a duplicate.
2. **Broken Retry.** Retry in the create flow calls `mirrorWrite` without the known locators. When `eth_getLogs` fails
   (public-RPC range limits, which get worse as the chain grows), Retry returns "failed" without uploading anything.
3. **No diagnosis.** A mirror failure shows nothing an operator could use.

## What Changes

- **Lookup on two indexes:** the configured fast index (`VITE_ARWEAVE_FAST_INDEX_URL`, default
  `https://turbo-gateway.com`) and the configured gateway. The copy counts as present if either serves byte-identical
  data for (vault ID, version). Unlocks stop re-uploading duplicates.
- **Retry keeps the locators:** the create flow keeps the locators it already knows in session state and passes them
  on Retry. Logs only ever add more.
- **Mirror failures get a "Details" disclosure** with a sanitized reference: the code (`UPLOAD_FAILED`,
  `LOOKUP_FAILED`, `NO_LOCATORS`), the HTTP status, and whether the lookup or the upload failed.
- **After a successful upload,** the app briefly shows the Arweave item ID, links it on the fast index, and notes that
  the permanent `arweave.net` link works after settlement.
- **CSP:** the fast-index origin is added to `connect-src` for the app document (config-driven), and is NOT added to
  the landing document, which runs third-party analytics.
- **Disclosure:** the privacy policy and the data-flow inventory name the fast index. The policy gets a new effective
  date.

**Out of scope:** `tools/recover` (a matching change follows separately); the upload format; the Turbo free tier;
paying for uploads.

**Runtime dependencies:** one more public read endpoint (Turbo's gateway, operated by Turbo/ArDrive, not by
CryoShield). There is no CryoShield backend.

## Capabilities

### New Capabilities
- `arweave-mirror-status`: how the app decides whether the Arweave copy exists, how it retries, and what it shows.

### Modified Capabilities
None in `openspec/specs/` (the original `arweave-vault-mirror` spec is in the unarchived `add-web-app` change; design.md
records the delta to fold in when it is archived).

## Impact

- Code:
  - `apps/web/src/mirror/mirror.ts`;
  - `src/ui/{operations,CreateFlow,VaultView,strings}.ts(x)`;
  - `src/config/schema.ts`;
  - `vite-plugins/{cryoshield,csp}.ts`;
  - `scripts/verify-build.mjs`, `deploy/gen-context.mjs`;
  - `.env.example`, `.env.e2e`.
- Docs: `docs/compliance/{origins.json,data-inventory.md}` and `legal/privacy.md`.
- Tests: unit (mirror, operations, UI, config), E2E (stub with settlement lag), container and verify-build.
