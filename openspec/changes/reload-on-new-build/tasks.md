# Tasks

> Owners: **[fe]** frontend, **[sec]** security review. **TDD:** each test first, then the code.

## 1. Plan

- [x] 1.1 [fe] Proposal, design, spec delta (`vault-web-app`) and tasks. Verify: `openspec validate --all --strict`.

## 2. Build check [fe]

- [x] 2.1 Tests first (`test/lib/build-check.test.ts`): `current` for equal entry sets (order and absolute/relative URLs normalised); `outdated` for a different entry; `unknown` for a rejected fetch, a timeout (fetch aborted), a non-2xx status, a non-HTML content type, and no module script on either side; the fetch is same-origin, `cache: 'no-store'`, no query; `assertCurrentBuild` throws `WriteError('OUTDATED')` only for `outdated` and never throws for `unknown` or a throwing check. Verify: they fail.
- [x] 2.2 `src/lib/build-check.ts` (`entryScripts`, `checkBuild`, `assertCurrentBuild`), `OUTDATED` in `src/account/errors.ts`, `buildCheck` in `Services`. Verify: 2.1 passes.

## 3. Write paths [fe]

- [x] 3.1 Tests first (`test/ui/build-check-flows.test.tsx`): with `buildCheck` reporting `outdated`, edit-save, rename, archive, add-key and create stop before any key ceremony, the write stack is not loaded, `sponsor.send` is not called, the draft stays, and the alert shows `S.save.outdated` with a Reload page button that calls `location.reload`; with `unknown` the save proceeds. Verify: they fail.
- [x] 3.2 `assertCurrentBuild` at the start of `saveNewVault`, `rewrite` and `saveAddKey`; `messageFor` and the notice title; `ReloadButton` in the error Notice for `outdated` and `loadFailed`. Verify: 3.1 passes.

## 4. Reload offers [fe]

- [x] 4.1 Tests first: the vault location `ChunkBoundary` fallback and the app chunk-failure notice show Reload page (`vault-location-chunk.test.tsx`, `components.test.tsx`); App shows the "new version" status notice when the check reports `outdated` on start or on `visibilitychange`, throttled to once per 60 s, and nothing for `current`/`unknown`. Verify: they fail.
- [x] 4.2 Implement (`components.tsx`, `VaultView.tsx`, `App.tsx`, `strings.ts`). Verify: 4.1 passes.

## 5. End to end [fe]

- [ ] 5.1 `e2e/specs/41-outdated-build.spec.ts` (desktop and phone projects): create and unlock a vault, then serve `/app/` with a different entry script; Save is refused with the alert and Reload page, the edit stays, and the vault version on chain is unchanged; after removing the route, Reload page reloads and a save succeeds. Verify: `pnpm test:e2e --project=chromium` and `--project=mobile`.
- [ ] 5.2 Full checks: lint, typecheck, unit tests, `pnpm build`, `verify-build`, `openspec validate --all --strict`. Verify: all green.

## 6. Security review [sec]

- [x] 6.1 Review against design.md D1–D7: every write path checked before any tap; no secret or identifier in the request; no storage; regex parsing reaches no DOM or Trusted Types sink; fail-open boundaries; user-started reload only. Record in design.md → Security review. Verify: no open CRITICAL or HIGH.
