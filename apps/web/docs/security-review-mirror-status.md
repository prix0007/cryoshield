# Security review: fix-arweave-mirror-status (new connect-src host)

- **Date:** 2026-10-04
- **Reviewer:** frontend-engineer (self-review)

**Verdict: APPROVED.**

| Check | Evidence | Result |
|---|---|---|
| Scope of the new origin | `https://turbo-gateway.com` (config `VITE_ARWEAVE_FAST_INDEX_URL`, https only, no credentials in the URL) is added to the **app** CSP `connect-src` only. The landing document, which runs the third-party beacon, never gets it: verify-build/gen-context allow the landing page only to *drop* `connect-src` sources, and the container test asserts `/` lacks it while `/app/` has it. The legal pages carry the app CSP but run no script. | Pass |
| Data sent | GraphQL `POST /graphql` with the tags `App-Name`, `CryoShield-Vault-Id`, `CryoShield-Version`, and `GET /<item id>`, with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. This is the same data `arweave.net` already receives. No keys, PRF output or plaintext. Disclosed in `/privacy` (new effective date) and inventory row 6; `origins.json` lists the host. | Pass |
| Spoofing | A lying index can only *claim* an item. Presence requires byte equality (≤ 1024 B, streamed cap) with the on-chain blob, which is the only authority. A malicious index can at most suppress the re-upload of an item it really serves. Unlock never uses Arweave data. | Pass |
| Response-supplied hosts | The upload response's `fastFinalityIndexes`/`dataCaches` are deliberately ignored. Read hosts come from configuration (and the CSP) only, so an upload endpoint can't steer later reads. | Pass |
| Diagnostics | The mirror reference is `CODE · HTTP nnn · step`: no URLs, keys or contents. The item link is an `<a rel="noopener noreferrer">` to `<fast index>/<43-char base64url id>`, and the id is validated against `^[A-Za-z0-9_-]{43}$` before rendering. | Pass |
| Retry | Uses the locators held in session state (public values already published on-chain), then adds any found in logs. No new data leaves the device. | Pass |
