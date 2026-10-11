# Design

## Decisions

### D1. A repo document rendered at build, like /devices
`docs/lost-or-compromised-key.md` is the single source: GitHub shows it (useful if this website is gone), and
`renderRepoDoc()` renders it through the escaped legal renderer into `apps/web/lost-key/index.html`. The route,
headers, CSP and verify-build treatment are those of `/devices` (`add-supported-devices-page` D2). The renderer has no
nested lists, so each step is an `h3` with a paragraph and a flat list.

Path `/lost-key`: short, says what a reader is looking for in a hurry. The page title and heading say "lost or
compromised".

### D2. What the guide claims, and where each claim comes from
Every factual claim is checked against the code or an existing spec, and the content test pins the risky ones:

| Claim | Source |
|---|---|
| Every key always asks for its PIN | credProtect level 3, `docs/spec/vault-format-v1.md` §3.1a; `docs/system-design.md` |
| Any one key with its PIN opens the vault and can change it (rename, archive, clear, add a key, save) | mode 0x01 any-of-N (§6.3); `strings-vaults.ts` "Any one of this vault's keys can rename, archive or clear it"; add-key needs one enrolled key (§6.6) |
| Every version stays public forever; anyone with any of the vault's keys and its PIN can read old versions | add-key and update keep the same data key (§6.6, §6.7); `strings-vaults.ts` clear-sheet points, quoted verbatim |
| CryoShield can't remove a key, delete versions, or recover anything | no remove-key flow in the app; append-only chain history and Arweave; no backend |
| "Archive and clear" saves the vault with no secrets in it | `strings-vaults.ts` clear intro |
| "Download encrypted backup file" is under "Vault details" | `strings.ts` `details`, `vault.details` |
| A FIDO2 reset erases every credential on the key | FIDO2 authenticatorReset (CTAP 2.1 §6.6) |

Deliberately **not** claimed:
- a PIN-attempt count (it differs by key and nothing in the repo verifies one); the guide says keys allow only a few
  wrong PINs;
- that an attacker can or can't remove the user's other keys: the wallet contract allows any owner to remove owners,
  but the app has no such flow. The guide says only that someone with a key and its PIN "can change what is stored
  in it", which covers both;
- anything about the recovery tool reading earlier versions.

### D3. Two situations, one rule when unsure
Lost or stolen with the PIN secret: credProtect level 3 means the key alone opens nothing, so the guide says to add a
replacement and keep at least two keys, and to consider the full steps as a precaution because the lost key can never
be removed. Anything else (PIN may be known, key out of sight with its PIN, malware on a device that showed the
secrets): the full steps, now. When unsure, the full steps. A compromised device is called out separately, because the
secrets may have been seen on screen whatever happened to the keys.

### D4. Step order
1. Trusted device and trusted key: everything after depends on not leaking more.
2. Change the secrets at their source: this is the only step that protects anything, so it comes before any vault
   work. CryoShield can't do it.
3. New vault with at least two trusted keys and the new secrets, never the compromised key.
4. Archive and clear the old vault: harmless, keeps the list honest, but does not erase old versions.
5. Update backups and notes: the downloaded encrypted backup file and any printed copy.
6. Reset or retire the compromised key last, because a reset erases every credential on it.

### D5. Links
- **Vault view:** a plain link under the "Manage vault" rows (`S.vault.lostKey`), visible in read-only vaults too. It
  opens the page in the same tab; the vault locks as on any navigation away, which the guide's first step expects.
  It is hidden while a write is in flight (`busy`), so a same-tab navigation can never hide a save's outcome (ECC
  review of #87, finding 3). It has a 24 px+ tap target and a visible focus ring.
- **Landing FAQ** "What happens if I lose my YubiKey?": one added sentence and link.
- **Footers:** "Lost or compromised key" next to "Supported devices".

### D6. CI path filter (owner follow-up)
`.github/workflows/ci.yml`'s `web` filter lists `docs/supported-devices.md`. It should also list
`docs/lost-or-compromised-key.md`. Agents can't push workflow changes, so the owner adds that line. Until then, a PR
that changes only the Markdown doesn't run the web tests; this PR runs them because it changes `apps/web`.

## Security review (2026-10-12)

Scope: the new page, its route and headers, the vault-view link, the guide's claims.

- **Rendering:** the Markdown goes through the existing escaped renderer with the link allowlist; the content test
  renders it and asserts no `<script`, `javascript:` or `on*=`. The page has the app CSP (checked equal to `/app/`'s),
  only the shared theme script, no third-party resource, no analytics. **Pass.**
- **Route:** Caddy clean URL, `no-cache`, 404 below it; container test. **Pass.**
- **App link:** a static same-origin `href="/lost-key"`; no new state, storage, request or write path; nothing about
  the vault (ID, key, label) is passed to the page. **Pass.**
- **Claims (social-engineering surface):** the guide tells readers never to share secrets, PINs or keys, including
  with anyone claiming to be CryoShield, and offers no contact for recovery. It names no third-party service to paste
  secrets into. **Pass.**
- **Claims (false comfort):** checked against D2's sources; the content test fails if the clear-sheet warnings drift
  from the app's text. A sentence-level guard (`falseComfort`) fails on any non-negated sentence promising to remove,
  revoke, delete or erase keys or versions, on a PIN-attempt count (digits or number words), on CryoShield recovering,
  restoring or unlocking anything, and on any "contact us/support". The guard is itself tested against sample bad
  sentences. Wording that dodges it is still possible; the guide's review is the backstop. **Pass.**
- **Residual:** guidance can't force users to rotate secrets; the guide says plainly that step 2 is the one that
  protects them. Markdown-only edits skip web CI until D6 is done.

No findings above LOW.
