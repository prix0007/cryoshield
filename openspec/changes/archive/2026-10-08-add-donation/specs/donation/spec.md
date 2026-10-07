# Spec Delta

## Purpose

Voluntary ETH donations to the project, made safe against address swaps: one validated source, a static `/support`
page, and a "Buy me a coffee" button on every page.

## ADDED Requirements

### Requirement: Single validated donation source
The donation address SHALL come only from `config/donation.json`, which SHALL be exactly `{ "address": "0xfb4172e26AC8735C06656f1df14151cFe8441481", "chainId": 1, "network": "Ethereum mainnet", "asset": "ETH" }`. The build SHALL refuse an address whose casing is not its EIP-55 checksum, any chain other than 1, and any asset other than ETH. The README SHALL publish the same address under "Support the project".

#### Scenario: Tampered config fails the build
- **WHEN** the address is lower-cased, its checksum casing is altered, or the chainId is changed
- **THEN** `loadDonation` throws and the build fails

### Requirement: Anti-swap build check
verify-build SHALL fail unless `/support` shows the configured address and no other 20-byte hex address, every `data-donation-address` element shows exactly the configured address, and every `ethereum:` URI in any built HTML or JS file is exactly `ethereum:<address>@1`. It SHALL also fail if shipped JS references an injected wallet (`window.ethereum`).

#### Scenario: Second address injected
- **WHEN** a build contains another address on `/support`, or a payment URI with another address or chain anywhere
- **THEN** verify-build fails and names the offending file

### Requirement: Support page
`/support` SHALL be a static page with the app CSP, every security header, `no-cache`, and no analytics. It SHALL show the address in monospace with checksum casing, a Copy button (clipboard API with a selection fallback; never cleared), a QR code generated at build time as inline SVG that encodes the EIP-681 URI `ethereum:<address>@1`, and an "Open in wallet" link with the same URI. It SHALL warn "Send only ETH on Ethereum mainnet. Tokens or other networks sent here may be lost.", tell donors to check the address against the GitHub README, and state that donations are voluntary, fund gas sponsorship, hosting and an audit, give no perks, are non-refundable, go to the open-source maintainer, and carry no tax receipts.

#### Scenario: QR matches
- **WHEN** the QR code in the built `/support` HTML is decoded
- **THEN** it yields exactly `ethereum:0xfb4172e26AC8735C06656f1df14151cFe8441481@1`

#### Scenario: Copy
- **WHEN** the user presses Copy
- **THEN** the clipboard holds exactly the address, a status message confirms it, and nothing clears it afterwards

### Requirement: No wallet integration
The site SHALL NOT include a wallet-connect library, call or probe `window.ethereum`, or add a `connect-src` host for donations. The CSP SHALL be unchanged.

#### Scenario: CSP unchanged
- **WHEN** `/support` is served
- **THEN** its CSP equals `/app/`'s, and no shipped JS references an injected wallet

### Requirement: Buy me a coffee button
Every page (landing, `/app`, legal pages, `/architecture`, `/devices`, `/support`) SHALL link "Buy me a coffee" to `/support` in its footer. The landing page SHALL show an Action Blue pill whose steam animates on hover or focus (CSS) and whose sheen is swept by Motion, both off under reduced motion. Decorative parts SHALL be hidden from assistive technology, and the link's accessible name SHALL be "Buy me a coffee".

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion and hovers the pill
- **THEN** no steam or sheen animation runs and the pill is a plain link

### Requirement: Donation terms and privacy
`/terms` SHALL state that donations are voluntary, non-refundable, buy no goods or services, and that the maintainer is responsible for any tax. `/privacy` SHALL state that donations are not tracked and that the blockchain is public.

#### Scenario: Legal pages updated
- **WHEN** the built `/terms` and `/privacy` are read
- **THEN** each has a "Donations" section with those statements, and their effective dates have changed
