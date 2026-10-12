## 1. Landing copy (mainnet): CTA note

- [x] 1.1 Tests first (`apps/web/test/landing/content.test.ts`): on chain 10 the hero strip equals the new string, the
      `#breaches .breach-cta .fine` and `#start .fine` paragraphs are absent (and no empty paragraph is left), the footer is
      unchanged, and the audit disclaimer is still visible outside any collapsible (footer); the testnet assertions are
      unchanged. Fails before 1.2.
- [x] 1.2 `apps/web/index.html`: drop the audit/backup sentence from the mainnet hero block; make both CTA fine prints
      whole-element `net:testnet` blocks.
- [x] 1.3 Verify: web lint, typecheck and unit/build tests; `openspec validate --all --strict`.
- [x] 1.4 Security review (honest copy) recorded in `design.md`.
- [x] 1.5 `docs/launch/op-mainnet-comms.md` ("At the switch"): quote the new mainnet hero and say where the audit
      statement now lives.

## 2. Audit status only in the footer, /terms and /privacy (founder requests 2 to 4)

- [x] 2.1 Tests first: on chain 10 no `.sub-nav .chip` on the landing page, the legal-header pages or `/app` (and no
      empty `<p>`); the app notice has no audit clause and keeps the all-keys-lost rule; the FAQ answers, the meta
      description, `llms.txt` and the share-image SVG and alt have the new wording; a build test checks that no chain-10
      public page other than `/terms` and `/privacy` says "unaudited" or "independently audited" outside the footer line,
      and that those keep it. Testnet assertions unchanged, plus a testnet FAQ guard. All failed before 2.2.
- [x] 2.2 Chips: whole-element `net:testnet` in `index.html` and `legal/partials/header.html`; `SubNav` `chip: string | null`,
      `App` passes `null` on a main network, `S.network.chipMainnet` removed.
- [x] 2.3 Copy: app notice (`strings.ts`), landing FAQ x3 and meta description (mainnet blocks), `llmsStatus` (mainnet).
- [x] 2.4 Share image: SVG pill, alt text (`seo.ts`), PNG and hash regenerated (`pnpm --filter @cryoshield/web og-image`).
- [x] 2.5 `docs/launch/op-mainnet-comms.md` "At the switch": landing, FAQ and app quotes.
- [x] 2.6 Specs: ADDED `landing-page` and `vault-web-app` requirements. When `launch-op-mainnet` is archived, reconcile its
      "Honest landing content" and "Network status notice in the app" with them (recorded in `design.md`).
- [x] 2.7 Verify: web lint, typecheck, full web tests; `pnpm exec openspec validate --all --strict`; testnet output of
      `index.html` and the legal header byte-identical to `origin/main`.
- [x] 2.8 Security review (honest copy) updated in `design.md`.
