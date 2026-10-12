# Proposal

## Why

On 2026-10-13, after the OP Mainnet launch, the founder asked four times to take the audit status out of the main
places a visitor sees it, because "unaudited" everywhere undermines the product. The status stays where it belongs
legally (quotes in `design.md`):
1. remove the audit and backup note from the landing calls to action; keep it in the footer;
2. remove the "Unaudited" tag at the top of the page in production;
3. remove the tag and the "has not been independently audited" clause from `/app`;
4. remove it from the FAQ too. Keep it in `/terms`, `/privacy` and the footer's legal line. Everywhere else, take it out
   or reword it so the page doesn't say "unaudited".

On a main network the audit status therefore stays in the footer's legal line (every page), `/terms` (including its meta
description) and `/privacy`. Every other place says true, positive things instead: the code is open source, encryption
happens on your device with well-known open-source libraries, the test vectors and internal security reviews are
public, and the recovery tool works without CryoShield. No copy claims or implies an audit.

## What Changes

All changes apply to **main-network builds only**, unless marked "every chain". Test-network output is byte-for-byte
unchanged.
- Landing page (`apps/web/index.html`):
  - the hero status strip loses its last sentence ("CryoShield has not been independently audited, so please keep your
    existing backups too.");
  - the two call-to-action fine prints are not rendered at all;
  - there is no "Unaudited" chip in the sub-nav;
  - the meta description ends "Free and open source." instead of "Free, open source, unaudited.";
  - the three FAQ answers are reworded positively ("Is it safe to use today?", "How do I back up my seed phrase forever?",
    "Where should I store 2FA backup codes?"). The backup advice stays, as normal good practice.
- The shared legal header (`legal/partials/header.html`: `/terms`, `/privacy`, `/cookies`, `/architecture`, `/devices`,
  `/support`, `/lost-key`) has no "Unaudited" chip.
- `/app`:
  - the sub-nav shows no chip (`SubNav` takes `chip={null}`, and `S.network.chipMainnet` is removed);
  - the network notice drops "and has not been independently audited". The all-keys-lost warning and "Please keep your
    existing backups too." stay.
- `llms.txt`: the status line says the code, the vault format and its test vectors are open source, instead of the
  audit sentence. The `/terms` entry still quotes that page's own description.
- Share image (every chain, because the card is chain-neutral): "· Not independently audited" is removed from
  `brand/og-image.svg`; `public/og-image.png` and `og-image.sha256` are regenerated; the alt text becomes
  "CryoShield: seed phrase backups that outlive the drive. Free and open source.".
- `docs/launch/op-mainnet-comms.md` ("At the switch"): quotes the new landing and app copy.
- Unchanged:
  - every testnet string;
  - the footer `.legal` line on every page;
  - `/terms` (body and meta description) and `/privacy`;
  - `/cookies` content;
  - the honesty denylists;
  - the release-notes and announcement texts in the comms plan.
- Specs (all ADDED, see `design.md`): `landing-page` "Mainnet audit status only in the footer and legal pages";
  `vault-web-app` "Mainnet app shell without an audit tag".

## Impact

- Copy and one prop (`SubNav` `chip: string | null`). No crypto, contract, paymaster or CI change.
- Files: `apps/web/index.html`, `apps/web/legal/partials/header.html`, `apps/web/src/ui/{App.tsx,chrome.tsx,strings.ts}`,
  `apps/web/vite-plugins/{network-copy.ts,seo.ts}`, `apps/web/brand/og-image.{svg,sha256}`,
  `apps/web/public/og-image.png`, the tests, and `docs/launch/op-mainnet-comms.md`.
