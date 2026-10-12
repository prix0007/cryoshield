## 1. Landing copy (mainnet)

- [x] 1.1 Tests first (`apps/web/test/landing/content.test.ts`): on chain 10 the hero strip equals the new string, the
      `#breaches .breach-cta .fine` and `#start .fine` paragraphs are absent (and no empty paragraph is left), the footer is
      unchanged, and the audit disclaimer is still visible outside any collapsible (footer) and in the FAQ "Is it safe to
      use today?"; the testnet assertions are unchanged. Fails before 1.2.
- [x] 1.2 `apps/web/index.html`: drop the audit/backup sentence from the mainnet hero block; make both CTA fine prints
      whole-element `net:testnet` blocks.
- [x] 1.3 Verify: web lint, typecheck and unit/build tests; `openspec validate --all --strict`.
- [x] 1.4 Security review (honest copy) recorded in `design.md`.
