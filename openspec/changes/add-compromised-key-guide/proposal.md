# Proposal

## Why

The founder asked for an in-app guide for when a hardware key is compromised: how to rotate the backed-up secrets and
move to a new vault.

Today the only guidance is the landing FAQ "What happens if I lose my YubiKey?" ("open it with another key and add a
replacement") and the "Archive and clear" sheet. Neither covers a key that someone else may hold **with its PIN**, and
the FAQ answer is not enough in that case:
- any one key and its PIN opens the vault, and can also change it (rename, archive, clear, add keys, save);
- every saved version stays public forever on chain and on Arweave, and add-key and edits keep the same data key, so
  any enrolled key can read every version, past and present;
- CryoShield has no way to remove a key, lock one out, or delete old versions.

So once a key and its PIN may be in someone else's hands, the only real protection is to change the secrets at their
source and start a new vault. Users need that said plainly, in order, before they need it.

## What Changes

- **Single source:** `docs/lost-or-compromised-key.md`. GitHub renders it in the repo, and the build renders it into a
  static page at **`/lost-key`**, exactly like `/devices` (legal renderer, app CSP, every security header, no analytics,
  `no-cache`). It has a "Last reviewed" date.
- **Content:**
  - what one key can and can't do (PIN always required; any key can read every version and change the vault);
  - two situations: lost or stolen with the PIN still secret (lower urgency), and key with PIN, or the unlocking device,
    compromised (urgent);
  - six ordered steps: trusted device and trusted key; change the secrets at their source; create a new vault with at
    least two trusted keys, never the compromised one; "Archive and clear" the old vault (old versions stay public);
    update backups and notes; reset or retire the compromised key last;
  - what CryoShield can't do (no server, no key removal, no deletion, never asks for secrets).
- **Links:**
  - the app's vault view, under "Manage vault": "Lost a key, or think someone has it?";
  - the landing FAQ "What happens if I lose my YubiKey?";
  - the footers of the landing page, `/app`, the legal-partial pages, `/architecture`, `/devices`, `/support` and the
    new page.
- **Plumbing:** the Vite input, the clean-URL rewrite, gen-context (Caddy route, no-cache, CSP pages), verify-build's
  page lists, the SEO page list and the deploy smoke test.
- **Also recorded:** the founder accepts, on 2026-10-12, that the 2026-10-11 mobile save was signed by an original key
  (owner index 1) rather than the new key (`harden-gas-sponsorship` 6.3).

## Capabilities

### New Capabilities
- `compromised-key-guide`: the lost-or-compromised-key page, its source, its content rules and its links.

## Impact

- **New files:** `docs/lost-or-compromised-key.md`, `apps/web/lost-key/index.html`, tests.
- **Changed:** `vite-plugins/legal*.ts`, `vite.config.ts`, `vite-plugins/seo.ts`, `deploy/gen-context.mjs`,
  `scripts/verify-build.mjs`, the footers (`legal/partials/footer.html`, `index.html`, `src/ui/chrome.tsx`),
  `src/ui/VaultView.tsx` and `src/ui/strings.ts` (the vault-view link), `.github/scripts/deploy/smoke.sh`.
- **Owner follow-up:** CI's `web` path filter (`.github/workflows/ci.yml`) should list
  `docs/lost-or-compromised-key.md`, as it lists `docs/supported-devices.md`, so an edit to the Markdown alone runs the
  web tests. Agents can't push workflow changes.
- **Nothing else:** no new dependency, no new origin, no CSP change, no crypto, contract or write-path change.
