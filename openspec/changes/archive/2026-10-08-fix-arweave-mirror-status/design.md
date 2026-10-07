# Design

## Context

- `src/mirror/mirror.ts`: `upload()` posts to Turbo; `lookup()` queries only `arweaveGatewayUrl`/graphql; `ensure()`
  byte-compares (≤ 1024 B) on that gateway, else uploads.
- **Turbo responses:** `/v1/info` reports `gateway: https://turbo-gateway.com`. Upload responses list
  `fastFinalityIndexes`/`dataCaches` (overwatcher, 2026-10-04). Turbo's gateway exposes `/graphql` and `/<id>` like
  arweave.net, and indexes items immediately.
- **CSP:** the app CSP's `connect-src` = the configured origins. The landing CSP = the app CSP + analytics sources, and
  `gen-context`/verify-build refuse any other landing difference.

## Decisions

### D1. Two indexes, either is enough
- **Flow:** `lookup()` queries the fast index first, then the gateway (each failure tolerated), and remembers which
  host listed each item. `ensure()` fetches the data from that same host and byte-compares it with the on-chain blob;
  identical bytes on either host mean present. Only on-chain bytes are ever trusted.
- **Fixed origin:** we use the configured fast index, not the hosts in the upload response's
  `fastFinalityIndexes`/`dataCaches`. The CSP must list origins statically, and trusting a response-supplied host
  would let a misbehaving upload endpoint steer reads. The configured value matches Turbo's `/v1/info` today.
- **Rejected:** waiting for settlement (hours, so the UI would be wrong in the meantime); trusting the upload's 200
  alone on later unlocks (the self-heal must verify).

### D2. Retry with known locators
- The create flow stores the locators returned by `saveNewVault` next to the session, and Retry passes them.
  `mirrorWrite` already merges logs into the given locators and tolerates a log failure. The bug was only the missing
  argument.
- The vault view already passes `[props.locator, …]`.

### D3. Results instead of bare statuses
- `mirrorWrite`/`ensureMirror` return `{ status, itemId?, ref? }`. `ref` is built from `MirrorError` (`code`, HTTP
  `status`, `step: 'lookup' | 'upload'`) or `NO_LOCATORS`. It has no URLs, keys or contents (same sanitising rule as
  the write-failure reference).
- `MirrorLine`:
  - failed: Retry plus `<details>`;
  - saved with an `itemId`: a link `<fast index>/<id>` (`rel="noopener noreferrer"`) and the settlement note.

### D4. CSP: app yes, landing no
- `VITE_ARWEAVE_FAST_INDEX_URL` is optional, defaults to `https://turbo-gateway.com`, is https-only (loopback http for
  dev), and is validated like the other endpoints.
- Its origin goes into the app's `connect-src` (and therefore into the legal pages, which carry the app CSP but run no
  script).
- The landing CSP is built without it. `gen-context` and verify-build now accept the landing CSP *dropping*
  `connect-src` sources (strictly fewer permissions), and still refuse any addition other than the analytics sources.
- No `img-src` change: the link is a navigation, not an image load.

### D5. Delta for `arweave-vault-mirror` (`add-web-app`, unarchived)
When `add-web-app` is archived, its "self-heal" requirement should say "the fast index or the configured gateway"
(this change's "Copy found on either index"). The recovery tool's matching change is separate (tools/recover is out of
scope here).

## Threat notes

- **New origin** `turbo-gateway.com` (Turbo/ArDrive, an already-listed processor): read-only GraphQL and data GETs
  with `credentials: 'omit'` and `no-referrer`. It sees the client IP and the vault ID/version being looked up, the
  same as arweave.net already does. This is disclosed in `/privacy` and the inventory.
- **Spoofing:** a malicious index can only claim an item exists. Presence requires byte equality with the on-chain
  blob, so it can at worst suppress a re-upload of an identical item that it serves.
- **Not on the landing page:** the third-party beacon's document cannot reach the new origin.

## Risks / Trade-offs

- **[The fast index serves the item, but it never settles on Arweave]** → Turbo's settlement is its own guarantee. The
  next unlock still checks both, and the item link lets users see it. Accepted.
- **[Two lookups per unlock]** → small JSON queries, run sequentially, and only once per unlock.
