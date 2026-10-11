# Proposal: fetch Arweave data from `/raw/<id>` and replace the dead second gateway

## Why

Checked live on 2026-10-12 (evidence in `design.md`):

- **arweave.net now redirects every plain data path.** `GET https://arweave.net/<id>` answers `302` to a per-item
  sandbox host (`https://<hash>.arweave.net/<id>`). The other ar.io gateways do the same (`turbo-gateway.com`,
  `ardrive.net`, `ar-io.dev`).
- **The recovery tool's second gateway is gone.** `https://ar-io.net` no longer resolves in DNS.
- **So the recovery tool cannot download any vault from Arweave with its defaults.** It fetches `<gateway>/<id>` and,
  by design (`net.py`), refuses every redirect; the only other gateway does not resolve. Recovery "without
  CryoShield" through Arweave, when the chain is unreachable, is broken. Launch task 7.8 (recover the mainnet vault
  through Arweave) would fail.
- **The web app re-uploads the mirror on every unlock.** `ensure()` byte-compares the listed item by fetching
  `<host>/<id>`. The browser follows the 302 to the sandbox host, which the app's CSP `connect-src` does not allow, so
  the fetch fails, the copy is never "found", and the app uploads a fresh copy. The founder's dev vault has **four
  identical uploads of version 10** on Arweave (`dvj2Ju7S…`, `TW3gzG4G…`, `8y-JQPaW…`, `6ofwicK-…`, plus `rqZS84f7…` on
  Goldsky's index), each made on an unlock.

`GET <gateway>/raw/<id>` answers `200` with the item's exact data bytes on every working gateway, with
`access-control-allow-origin: *`, and no redirect. It returns the same bytes on all of them.

## What Changes

- **Recovery tool:** download each transaction's data from `<gateway>/raw/<id>` (the id is already checked against
  `^[A-Za-z0-9_-]{43}$`). Redirects stay refused; the 1024-byte read cap, per-gateway fallback and all candidate checks
  are unchanged.
- **Recovery tool defaults:** gateways become `https://arweave.net` and `https://turbo-gateway.com` (ArDrive / PDS, a
  different operator from ar.io's arweave.net; already listed in the compliance inventory as the app's fast index).
  GraphQL servers are unchanged (`arweave.net`, Goldsky); both answer today.
- **Web mirror:** `ensure()` byte-compares data fetched from `<host>/raw/<id>` with `redirect: 'error'`. No CSP change:
  `/raw/` is on the same origins the app already allows.
- **Tests:** fake gateways in both test suites now behave like the real ones (302 on the plain path, data on
  `/raw/`), so the old code fails them; a new opt-in live test (`-m network`) downloads a known public CryoShield item
  through each default gateway's `/raw/` path and checks its bytes.
- **Docs:** the recovery README's manual-recovery instructions and the security-review notes name the `/raw/<id>`
  path.

Not changed: the user-clicked "Arweave item" link in "Where your vault is stored" (`arweaveUrl`). A browser navigation
may follow the redirect, and the sandbox page shows the same bytes.

## Impact

- `tools/recover`: `arweave.py` (fetch path), `config.py` (default gateways), tests, docs.
- `apps/web`: `src/mirror/mirror.ts`, unit tests, the e2e Arweave fixture.
- Specs: `vault-recovery` (Arweave fallback), `arweave-mirror-status` (copy found on either index).
- Conflicts: `feat/mainnet-recovery-default` (unmerged) also edits `tools/recover/src/cryoshield_recover/config.py`;
  this change touches only the `ARWEAVE_GATEWAYS` line, outside that branch's hunks.
