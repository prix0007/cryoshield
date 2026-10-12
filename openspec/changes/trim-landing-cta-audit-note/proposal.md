# Proposal

## Why

On 2026-10-13 the founder asked to take the audit and backup note out of the landing page's calls to action on OP
Mainnet, and to keep it in the footer:

> "CryoShield has not been independently audited, so please keep your existing backups too. remove this from landing
> CTA, it's fine to keep in footer."

The note was repeated three times above the fold and around the two calls to action. The audit status stays visible
on the landing page (chip, footer, FAQ) and on every legal page, so the page stays honest with one fewer repetition.

## What Changes

- `apps/web/index.html`, **mainnet build only** (`<!--net:mainnet-->` blocks):
  - the hero status strip drops "CryoShield has not been independently audited, so please keep your existing backups
    too." and reads "Runs on OP Mainnet. Your vault is encrypted on your device and stored on OP Mainnet, with an extra
    copy on Arweave when that upload succeeds.";
  - the fine-print paragraph under the breaches call to action and under the final call to action (`#start`) is not
    rendered at all (no empty paragraph).
- Unchanged: every testnet string (hero, both fine prints), the footer `.legal` line, the chip ("Unaudited"), the FAQ
  answers, meta and share image, `/terms`, `/privacy`, the app's network notice, the honesty denylists.
- Spec `landing-page`: ADDED requirement "Mainnet calls to action without an audit note".

## Impact

- Copy only: `apps/web/index.html` and `apps/web/test/landing/content.test.ts`. No code, crypto, contract or CI change.
- `docs/launch/op-mainnet-comms.md` ("At the switch") quotes the old mainnet hero; it is outside `apps/web` and is
  flagged to the overwatcher rather than edited here.
