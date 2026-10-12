# Design

## Decisions (founder, 2026-10-13)

Verbatim requests, in order:

1. > "CryoShield has not been independently audited, so please keep your existing backups too. remove this from landing
   > CTA, it's fine to keep in footer."
2. > "Also move this from top as a tag: Unaudited from production."
3. > "also remove this from /app and has not been independently audited."
4. > "remove from faq, fine to keep in terms, privacy and legal. rest remove it / make it crafty to avoid unaudited as it
   > undermines the product."

As scoped by the overwatcher:
- the changes apply to the **main-network** build only, and test networks keep every current string;
- on a main network the audit status stays only in the footer's `.legal` line (on every page), `/terms` and `/privacy`;
- `/cookies` and the other legal pages keep what they have (none of them had the status outside the header chip and
  the footer);
- every other place drops it, or is reworded positively and honestly.

## How

- **Whole-element blocks.** The chip (landing and legal header) and the two CTA fine prints are wrapped whole in
  `<!--net:testnet-->…<!--/net-->`, as the `net:moving` notice already is. On a main network nothing is left, not even an
  empty `<p>`. Blocks don't nest (`vite-plugins/network-copy.ts`), so the inner testnet/mainnet split inside each element
  is lifted out. The resolved testnet output of `index.html` and `legal/partials/header.html` was compared with
  `origin/main` for chains 11155420 and 31337: identical.
- **FAQ.** Where a sentence was shared by both chains, the testnet block now carries the whole old sentence and the
  mainnet block carries the new one, so the testnet text does not change.
- **Meta description.** "Free<!--net:testnet-->, open source, testnet<!--/net--><!--net:mainnet--> and open source<!--/net-->."
  This is 151 characters on mainnet, inside the 150–160 limit enforced by `seo.ts`.
- **App.** `SubNav`'s `chip` prop is `string | null`. It still defaults to "Testnet" (fail safe), and `null` renders no
  chip. `App` passes `null` on a main network, and `S.network.chipMainnet` is deleted.
- **Share image.** The card is one PNG for every chain (launch-op-mainnet 4.2), so dropping "Not independently audited"
  changes it on testnet too. That is acceptable: on testnet the hero, chip, CTAs, FAQ and footer still say it. The PNG is
  regenerated with `pnpm --filter @cryoshield/web og-image` (Playwright Chromium, self-hosted Inter), the hash is
  re-recorded, and the alt text matches the card.

### New mainnet copy

- **FAQ "Is it safe to use today?"** "CryoShield runs on OP Mainnet. Your secrets are encrypted on your device before
  anything is stored, using well-known open-source cryptography libraries (@noble). The code, the vault format and its
  published test vectors are open source, and our internal security reviews are public in the repository. If this
  website ever disappears, the open-source recovery tool still opens your vault with one of your keys. As with any
  backup, keep a second copy somewhere safe."
- **FAQ "forever".** "… at least one of your keys still works. CryoShield runs on OP Mainnet. As with any backup, keep a
  second copy somewhere safe."
- **FAQ 2FA.** "… only your security keys can open it. As with any backup, keep a printed copy somewhere safe as well."
- **App notice.** "CryoShield runs on ${network}. Your vault is encrypted on your device and published permanently as
  ciphertext on a public blockchain, and only your keys can open it: if you lose every key, nobody, including
  CryoShield, can open it. Please keep your existing backups too."
- **llms.txt status.** "… Vaults are stored on OP Mainnet, with an extra copy on Arweave when that upload succeeds. The
  code, the vault format and its test vectors are open source. Only the security keys enrolled for a vault can open it:
  if you lose every key, nobody can open it."

Every claim is true today:
- the code and the vault format are open source, with test vectors in `packages/vault-crypto/test-vectors/`;
- the security review records are in `docs/reviews/` and `docs/security-review-*.md`;
- encryption is client-side with `@noble`;
- `tools/recover` opens a vault from public data.

"Internal" is kept, so the reviews are not mistaken for an outside one.

## Why ADDED requirements, not MODIFIED

The requirements that say "not been independently audited… visible" on mainnet live in the **unarchived**
`launch-op-mainnet` change:
- `landing-page` "Honest landing content" (MODIFIED there);
- `vault-web-app` "Network status notice in the app" (ADDED there, so it is not yet in `openspec/specs`).

A MODIFIED delta here would either fail validation (the `vault-web-app` requirement isn't in the main specs yet) or
overwrite or be overwritten depending on archive order (the `landing-page` one). This change therefore ADDs narrower
requirements that override them for main networks:
- `landing-page` "Mainnet audit status only in the footer and legal pages";
- `vault-web-app` "Mainnet app shell without an audit tag".

When `launch-op-mainnet` is archived, its two requirements should be reconciled with these. That is recorded as task 2.6.

## Security review: honest copy (2026-10-13, updated for requests 2 to 4)

Scope:
- public copy;
- one presentational prop (`SubNav` `chip`);
- the share image.

No crypto, contract, paymaster, secret-handling or CI change.

**On a main network, the audit status is still stated in:**
- the footer `.legal` line, "Runs on OP Mainnet, not independently audited.", on the landing page and every page that
  uses the shared footer, outside any collapsible;
- `/terms`: "In short", "Network and audit status", and its meta description;
- `/privacy`: "Security".

**Removed on a main network:**
- landing: the hero sentence, the CTA fine prints, the chip, the FAQ clauses and the meta description word;
- the legal header chip;
- the app chip and the notice clause;
- the `llms.txt` status sentence;
- the share image (every chain).

**No audit claim or implication is made.**
- The new copy never uses "audited", "audit", "secure", "verified", "guaranteed" or "unhackable".
- "Internal security reviews" is a fact, with the records in the repo, and is marked internal.
- The honesty denylists (`test/landing/banned.ts`, including `AUDIT_PROMISES`) are unchanged and pass on both chains.
- A new build test (`test/build/public-pages-honesty.test.ts`) fails if a chain-10 page other than `/terms` or
  `/privacy` says "unaudited" or "independently audited" outside its footer line (text, meta and alt), or if `llms.txt`
  does outside its `/terms` and `/privacy` entries. The same test also requires the footer line on every page and the
  statement on `/terms` and `/privacy`.

**Unchanged:**
- the all-keys-lost warning (landing Resilience tile, app notice, `llms.txt`, legal pages);
- the backup advice, now framed as normal practice ("As with any backup…").

**Residual risk (accepted by the founder):**
- a mainnet visitor now sees the audit status only in small footer text and the legal pages;
- the launch-op-mainnet D6 principle "always present on both chains: … not been independently audited" no longer holds
  for prominent placement on mainnet.

This is a product decision, not a defect. The copy stays truthful, and nothing claims a review that did not happen.

Finding: none blocking.
