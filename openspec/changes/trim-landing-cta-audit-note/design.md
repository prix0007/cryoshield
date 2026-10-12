# Design

## Decision (founder, 2026-10-13)

Verbatim request:

> "CryoShield has not been independently audited, so please keep your existing backups too. remove this from landing
> CTA, it's fine to keep in footer."

Interpreted, as scoped by the overwatcher, as: on the **OP Mainnet** build, remove the audit/backup note from the hero
status strip and from the fine print under both calls to action; keep it in the footer. Testnet copy is not touched.

## How

- The hero strip's `<!--net:mainnet-->` block loses its last sentence. The testnet block is untouched.
- Each CTA fine print becomes a whole-element block, as the `net:moving` notice already is:
  `<!--net:testnet--><p class="fine …">Testnet preview on __CS_NET_NAME__, not independently audited. Please keep your
  existing backups too.</p><!--/net-->`. On a mainnet build the block resolves to nothing, so no empty `<p>` is left.
  The testnet output is byte-for-byte the same text as before.
- Blocks don't nest (`vite-plugins/network-copy.ts`), so the inner `net:testnet` / `net:mainnet` split is removed;
  the inner text was testnet-only anyway once the mainnet branch is gone.

## Why an ADDED requirement

"Honest landing content" is MODIFIED by the unarchived `launch-op-mainnet` change. A second MODIFIED delta on the same
requirement would overwrite or be overwritten depending on archive order. This change therefore ADDs a narrow
requirement and leaves "Honest landing content" (network, audit status, all-keys-lost, no audit claim) as it is.

## Security review: honest copy (2026-10-13)

Scope: public copy only; no crypto, contract, paymaster, secret-handling or CI change.

On the OP Mainnet build, "not (been) independently audited" or "Unaudited" is still visible:
- landing page: the chip ("Unaudited"), the footer `.legal` line ("Runs on OP Mainnet, not independently audited.",
  outside any collapsible, so visible with scripts and motion off), and the FAQ answers "Is it safe to use today?",
  "How do I back up my seed phrase forever?" and "Where should I store 2FA backup codes?" (the last two also keep
  "keep your existing backup" advice);
- meta description ("… unaudited.") and the share image ("Not independently audited");
- `/terms` ("In short" and "Network and audit status"), `/privacy`;
- the app shell's network notice (`S.network.mainnet`), which still says "Please keep your existing backups too."

No audit claim is added; the honesty denylists (`test/landing/banned.ts`, `public-pages-honesty.test.ts`) are unchanged
and still pass on both chains. The all-keys-lost warning is not affected. Finding: none. The change reduces repetition,
not disclosure.
