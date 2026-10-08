# Design

## Context

The landing page's opening runs hero (light) → numbers (parchment) → fragile (dark scene) → how (light scene). The new
tile goes between `fragile` and `how`. A parchment tile keeps the light/dark rhythm (dark scene, then a light tile,
then the light `how` scene) and reuses the `.tile-parchment` themed surface from add-theme-switch, so it is light in
the light theme and dark in the dark theme with no new tokens.

## Decisions

- **D1. A plain tile, not a pinned scene.** Cards are reading content; pinning would trap the reader. No
  `data-scene`, so `src/landing/scenes/*` and `boot.ts` (which looks only for `[data-scene]`, `#only-you table` and the
  dark-surface classes for the sub-nav) are untouched. No new JavaScript: the landing JS budget is unchanged.
- **D2. Cards from existing grammar.** `tile tile-parchment` with `tile-title` and `tile-lead`; each card is an
  `<article>` with an `<h3>` label, so the H2 order stays the story order. Card surface `--canvas` on the parchment tile
  with a `--hairline` border and `--radius-lg`; the "helps" line sits under a `--hairline` divider, in `--ink` and
  semi-bold, after a check icon in `--color-primary` (themed link blue). The label uses `--ink-muted-48` and the
  incident `--ink-muted-80`; all are page tokens already contrast-tested in both themes (`test/ui/tokens.test.ts`).
- **D3. Grid.** `grid-template-columns: repeat(3, minmax(0, 1fr))` above 833 px, one column at or below 833 px (the
  same breakpoint the steps and footer columns use). `minmax(0, …)` and `overflow-wrap: anywhere` on links keep 390 px
  free of horizontal scroll.
- **D4. Source links.** Visible text "Source: BleepingComputer" etc., so the accessible name says what the link is.
  `rel="noopener noreferrer"`, no `target`. They are plain text links (not pills), so the "every pill goes to the app,
  an anchor or the project" rule still holds; the content test's external-link allowlist lists exactly these three
  URLs besides the repository.
- **D5. CTA row.** An `<h3>` "Take your seed phrase out of the cloud." and a `.ctas` row with two pills, primary
  `/app/`, secondary the repository.
- **D6. New requirement instead of editing "Honest landing content".** The pending change `launch-op-mainnet` already
  MODIFIES "Honest landing content"; a separate ADDED requirement ("Breach stories with sources") avoids an archive
  conflict and keeps the incident rules in one place.
- **D7. Third-party names.** LastPass, SparkCat, Slope, App Store and Google Play appear only as factual reporting of
  cited incidents, never as CryoShield branding (spec "Honest landing content"). The "Only you can read it." tile's
  no-competitor rule is scoped to that tile and is unchanged.

## Sources (checked 2026-10-09)

| Card | Claim | Source | What the source says |
|---|---|---|---|
| LastPass, 2022 | Encrypted vault backups stolen; weak master passwords cracked offline; over $35 million in crypto thefts traced through 2025 | BleepingComputer, https://www.bleepingcomputer.com/news/security/cryptocurrency-theft-attacks-traced-to-2022-lastpass-breach/ | TRM Labs traced $28 million (late 2024 to early 2025) plus $7 million (September 2025); backups stolen from GoTo cloud storage; weak or reused master passwords vulnerable to offline cracking, ongoing since the breach. |
| SparkCat, 2025 | Store apps scanned galleries with text recognition for seed phrase screenshots | Kaspersky, https://www.kaspersky.com/about/press-releases/kaspersky-discovers-new-crypto-stealing-trojan-in-appstore-and-google-play | Reported February 2025; apps in the App Store and Google Play (active since at least March 2024) used OCR / machine learning to scan galleries for recovery-phrase screenshots. "2025" is the year it was disclosed. |
| Slope, 2022 | Seed phrases sent in plain text to a logging server; thousands of Solana wallets drained | The Block, https://www.theblock.co/post/161425/slope-wallet-provider-saved-user-seed-phrases-in-plain-text-solana-security-researchers-find | Otter found the mobile app sent mnemonics (over TLS, unencrypted by the app) to its Sentry server, stored as readable text; nearly 8,000 Solana wallets affected. |

"Plain text" follows the source's own headline: the phrases were not encrypted by the app (the transport was TLS).

## Honesty review

- Every "helps" line describes shipped behaviour only: no master password (keys derive from the security key's PRF
  secret, which never leaves the key); sealing happens in the browser and opening needs a tap on the physical key;
  encryption happens before storage or sending; the code is open source.
- The tile does not say CryoShield stops malware; the honest-limit line says the opposite for an infected device.
- The copy passes `test/landing/banned.ts`; the test runs it on the tile's text and the whole page.

## Risks / Trade-offs

- **[Figures age]** → the sources and check date are recorded above; the copy uses "over $35 million … through 2025"
  so it stays true as a lower bound.
- **[Outbound links to news sites]** → ordinary navigation links only; nothing is fetched at load, so the CSP and the
  no-third-party-request guarantees are unchanged.

## Security review

Not crypto, contracts, the paymaster, secret handling or CI. The change adds static HTML and CSS only. CSP unchanged
(no inline style or script; `scripts/csp-check` and `verify-build` stay green). Links use `rel="noopener noreferrer"`
and no `target`. N/A beyond this note.
