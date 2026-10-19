# Design

## Context

`app-motion-ux` guardrail (g): Motion comes from ONE exact pin, with no second copy and no direct `framer-motion`.
The pin is enforced by `motion-pin.test.ts` (package.json and the four lockfile entries) and by `assets.test.ts`
(`docs/design/ASSETS.md` names `motion@<pinned>`). A major bump therefore needs a change, not a Dependabot merge.

## Decisions

### D1. Take 14.0.0 as a whole, not 13.5.1

13.5.1 and 14.0.0 were published the same day. 14.0.0 only drops shims for mixing `framer-motion` 13.0–13.4 with
newer internals, a combination the pin test forbids here. Pinning 13.5.1 would take the fixes and stay on a line
that gets no further releases. The imports the app uses (`scroll`, `animate` from `motion/mini`, `LazyMotion`,
`domAnimation`, `AnimatePresence`, `MotionConfig`, `PresenceContext`, `useIsPresent`, `useReducedMotion`,
`motion/react-m`) are all public API, unchanged between 13.5.0 and 14.0.0.

### D2. The exact pin stays; only its value moves

`package.json` keeps the bare version (`14.0.0`, no range), `pnpm add --save-exact` wrote it, and the lockfile
resolves one version of each of the four packages. The guardrail test is edited to the new value, not loosened to
a range or to "whatever package.json says": a bump must remain a visible, reviewed edit in two places.

### D3. Records

`ASSETS.md` is the live record and is updated: version, the grep of the new dists (dated), and the usage column,
which still said "landing page only" from before `app-motion-ux`. The security reviews under `apps/web/docs/` are
dated records of what they reviewed and are left as written.

## Threat / abuse

Supply chain only; no crypto, contract or paymaster path changes.

- **Tampered package:** pnpm installs from the lockfile's integrity hashes (`sha512-…`, new for all four
  packages) with install scripts disabled repo-wide (`pnpm.onlyBuiltDependencies: []`). `pnpm install
  --frozen-lockfile` in CI refuses any drift.
- **CSP-hostile code:** the four packages' `dist` trees (940 files) were grepped on 2026-10-19 for `innerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` and `WebAssembly`: no match, as for 13.5.0.
  Motion still writes styles through the CSSOM, which `style-src 'self'` does not restrict.
- **Bundle growth:** `verify-build` on 14.0.0 reports the `/app` initial JavaScript at 207,631 B gzip against the
  187,521 B baseline (+20,110 B, allowance +20,480 B) and the landing total at 11.16 KB of 120 KB, with no
  React or Motion React code in the landing graph. On `main` at #114 (13.5.0) the same figure was 207,745 B, so
  14.0.0 is 114 B smaller. The budgets hold; the `/app` headroom is 370 B, which the next change touching `/app`
  JavaScript should know about.
- **Second copy / direct framer-motion:** still refused by the pin test and the `lint-motion` rules.

## Security review (2026-10-19)

| # | Area | Check | Result |
|---|---|---|---|
| 1 | Supply chain | Exact pin `14.0.0`; one version of `motion`, `framer-motion`, `motion-dom`, `motion-utils` in the lockfile; integrity hashes; install scripts disabled | Pass |
| 2 | CSP | Grep of the 14.0.0 dists for DOM-string and eval sinks | Pass (no match) |
| 3 | Budgets | `verify-build`: `/app` within +20 KB, landing within 15 KB initial / 120 KB total, landing graph free of React and Motion React | Pass (370 B `/app` headroom) |
| 4 | Behaviour | Web unit suite (103 files, 1,496 tests) and `verify-build` reproducible build on 14.0.0 | Pass |
| 5 | Records | `ASSETS.md` row, grep note and usage column updated; dated reviews untouched | Pass |

## Risks / Trade-offs

- The `/app` budget headroom is small (370 B; it was 256 B on 13.5.0). If a later Motion release grows, the
  budget, not the pin, is the thing to revisit, in its own change.
