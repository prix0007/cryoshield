# Spec Delta

## MODIFIED Requirements

### Requirement: Support page
`/support` SHALL be a static page with the app CSP, every security header, `no-cache`, and no analytics. It SHALL show the address in monospace with checksum casing, a Copy button (clipboard API with a selection fallback; never cleared), a QR code generated at build time as inline SVG that encodes the EIP-681 URI `ethereum:<address>@1`, and an "Open in wallet" link with the same URI. It SHALL warn "Send only ETH on Ethereum mainnet. Tokens or other networks sent here may be lost.", tell donors to check the address against the GitHub README, and state that donations are voluntary, fund gas sponsorship and hosting, give no perks, are non-refundable, go to the open-source maintainer, and carry no tax receipts. It SHALL NOT say or imply that donations fund an audit (founder decision 2026-10-09: no audit is planned).

#### Scenario: QR matches
- **WHEN** the QR code in the built `/support` HTML is decoded
- **THEN** it yields exactly `ethereum:0xfb4172e26AC8735C06656f1df14151cFe8441481@1`

#### Scenario: Copy
- **WHEN** the user presses Copy
- **THEN** the clipboard holds exactly the address, a status message confirms it, and nothing clears it afterwards

#### Scenario: No audit promise
- **WHEN** the built `/support` page, its description and `llms.txt` are checked against the honesty denylist
- **THEN** none says that donations fund an audit or that an audit is coming
