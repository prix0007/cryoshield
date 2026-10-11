# Design: fetch Arweave data from `/raw/<id>`

## Evidence (2026-10-12, 21:43 UTC; `curl`, redirects not followed)

Known public item `yQwP3XFuFo_5SIhTq6ZdgDdWV_miWjsEtknTfbptRPs` and GraphQL `POST /graphql` (`first:1`):

| Gateway | `/<id>` | `/raw/<id>` | GraphQL |
| --- | --- | --- | --- |
| `https://arweave.net` | 302 → `https://<hash>.arweave.net/<id>` | 200 | 200 |
| `https://ar-io.net` | DNS: could not resolve host | — | — |
| `https://turbo-gateway.com` | 302 | 200 | 200 |
| `https://ar-io.dev` | 302 | 200 (504 on two older items) | 200 |
| `https://ardrive.net` | 302 | 200 | 200 |
| `https://permagate.io` | 503 | 503 | 200 |
| `https://arweave.developerdao.com` | 502 | 502 | 502 |
| `https://g8way.io`, `https://arweave.services.kyve.network` | unreachable | — | — |
| `https://arweave-search.goldsky.com/graphql` | — | — | 200 |

The founder's dev vault (`0x94a68b0b…5e87`) on Arweave, listed by `arweave.net`, `turbo-gateway.com` and Goldsky:

| Item | Version | Size | `/raw/` on arweave.net, turbo-gateway.com, ardrive.net |
| --- | --- | --- | --- |
| `zIJNxEtKEtQGUY_3rveaVJCtpnFqyydci-1EPz0Ybj4` | 11 | 999 | 200, identical bytes (sha256 `68844c2d…`) on all three, and on ar-io.dev |
| `dvj2Ju7S…`, `TW3gzG4G…` (and three more) | 10 | 615 | 200, identical bytes (sha256 `1c01c589…`) |

Five uploads of version 10 is the web bug in action: each unlock failed to byte-verify the existing copy and uploaded
another. `/raw/` answers carry `access-control-allow-origin: *` and `content-type: application/octet-stream` on both
arweave.net and turbo-gateway.com, so the browser can read them.

## Decisions

**D1. Fetch `<gateway>/raw/<id>`; keep refusing redirects.** The redirect goes to a host derived from the item id, a
different origin each time. Following it in the recovery tool would mean trusting a gateway-chosen URL (the tool's
rule, kept: endpoints are untrusted, redirects refused); in the browser the CSP blocks it anyway. `/raw/` serves the
data without manifest resolution, which is what a vault blob is. The id is already validated (`_TXID`, 43 base64url
characters; the web filters ids the same way), so it cannot change the path.

**D2. Second default gateway: `https://turbo-gateway.com`.** Requirements: answers `/raw/<id>` with 200 and no
redirect, run by a different operator from arweave.net, already known to the project. turbo-gateway.com (ArDrive /
Permanent Data Solutions) meets all three: it is the app's fast-finality index and already in
`docs/compliance/origins.json` and the privacy notice. `ardrive.net` is the same operator; `ar-io.dev` is ar.io's and
timed out on two items; `permagate.io` returned 503. A user can still pass any gateway with `--arweave-gateway`.
GraphQL defaults stay `arweave.net` and Goldsky (two operators, both 200).

**D3. Web: `redirect: 'error'` on the data fetch.** Makes the "no redirect" rule explicit rather than relying on the
CSP to block the hop. A redirect is treated like any other failed fetch: try the next listed item, then upload.

**D4. Tests model the real gateways.** The fake gateways (Python `FakeArweave`, the web unit fakes, the Playwright
`ArweaveStub`) answer the plain path with a 302 and serve data only on `/raw/`. The old code fails against them, which
is the regression test (checked: the old web code fails the e2e "no duplicate on unlock" spec with a second upload).
A live, opt-in test (`-m network --run-network`) fetches `zIJNx…` (999 bytes, the dev vault's version 11, public)
through each default gateway with the tool's own `Arweave.fetch`, and checks its length, its sha256 (recorded above)
and that it decodes as a format-1 blob with three keys.

## Risks

- **Gateways change again.** Two operators by default, any number by flag; the live test is the early warning (run it
  before a release, checklist step 3.2). Accepted.
- **A gateway serves wrong bytes on `/raw/`.** Unchanged from today: the tool authenticates every blob (decrypt and
  chain-event hash checks) and the web byte-compares with the on-chain blob before reporting "present".

## Security review (2026-10-12, recovery-engineer + frontend, self-review; independent ECC review on the PR)

| Check | Result |
| --- | --- |
| Redirects | Still refused in the tool (`net.py` unchanged); web now sets `redirect: 'error'`. Pass |
| Path injection | `<id>` validated before use in both codebases (43-char base64url); gateway URLs fixed by config/flags (`check_url`). Pass |
| Size cap | 1024-byte cap unchanged in both (`get_capped`, `readCapped`). Pass |
| Authenticity | No trust added: the tool still authenticates each blob; the web still byte-compares with the on-chain blob. Pass |
| New origins | None in the web (CSP unchanged). Tool adds `turbo-gateway.com`, already a listed subprocessor. Pass |
| Privacy | Same requests as before (item id only, `credentials: 'omit'`, no referrer). Pass |

No CRITICAL/HIGH/MEDIUM findings. LOW (accepted): the defaults could both be ArDrive-hosted in future if arweave.net
changes operator; the flag remains.
