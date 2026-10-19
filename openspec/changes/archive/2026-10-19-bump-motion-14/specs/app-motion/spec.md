# Spec Delta

## MODIFIED Requirements

### Requirement: Lazy features and budget
The app SHALL load Motion via `LazyMotion features={domAnimation} strict` and use only `m.*` components; importing
`motion` from `motion/react` or `framer-motion` SHALL be a lint error. The `/app` initial JavaScript MUST stay within
20 KB gzip of the pre-change baseline, and the landing page's JavaScript graph MUST NOT include React or Motion's
React code. Motion SHALL come from the single pinned `motion` dependency: one exact version in `apps/web/package.json`,
resolved once in the lockfile for `motion`, `framer-motion`, `motion-dom` and `motion-utils`, and recorded as
`motion@<version>` in `docs/design/ASSETS.md`. A test SHALL fail when any of the three disagree, so a version bump is
a reviewed change to the test and the record, never a dependency update alone.

#### Scenario: Budget enforced
- **WHEN** `verify-build` runs
- **THEN** it prints the `/app` initial gzip size and fails if it exceeds the baseline plus 20 KB, and the landing checks are unchanged

#### Scenario: Landing untouched
- **WHEN** `verify-build` compares the landing and `/app` JavaScript graphs
- **THEN** they share no chunk other than the bundler's preload helper, so Motion for React never changes the landing bundle

#### Scenario: Pin moved without its record
- **WHEN** `package.json` or the lockfile carries a `motion` version that the pin test or `ASSETS.md` does not name
- **THEN** the web unit suite fails on the pin test or the assets test, and CI stays red until both are updated
