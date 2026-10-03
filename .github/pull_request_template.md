<!--
One PR per change. See CLAUDE.md -> "Change flow (one PR per change)".
Title: Conventional Commits, e.g. `feat(web): add key enrolment screen` (CI checks it; it becomes the squash commit).
Branch: feat/…, fix/…, ci/…, docs/…, chore/…
-->

## OpenSpec change

<!-- The change this PR proposes, implements or archives: `openspec/changes/<name>/`.
     Code changes without a change fail CI unless the PR has the `no-spec` label AND the line below is filled in. -->
Change: 

No-spec justification: 

## Summary

<!-- What and why, in a few bullets. -->

## Tasks covered

<!-- The tasks.md ids this PR completes, e.g. 4.1–4.3. -->

## Verification

<!-- Commands you ran and their result, e.g. `pnpm --filter @cryoshield/web test` (pass). Tests were written first (TDD). -->
- 

## Security review

<!-- Link to the review record (docs/reviews/…, design.md section) for changes touching crypto, contracts,
     the paymaster, secret handling or CI. Otherwise write N/A. -->
Review: 

## Screenshots (UI changes)

<!-- Before/after for any visible change in apps/web. Otherwise write N/A. -->

## Review

- ECC review runs automatically on every push (`ecc-review` check); pushing fixes re-runs it, and a comment starting with `/ecc-review` from the owner re-runs it on demand. Reply to each finding with what changed.
- **Auto-merges** (squash, via the `auto-merge` workflow) into `main` once every required check passes (`ci-ok`, plus `ecc-review` once enabled). Add the `hold` label to stop it.

## Checklist

- [ ] OpenSpec tasks ticked in `tasks.md`
- [ ] Tests added first (TDD) and passing locally
- [ ] No secrets, keys or real seed phrases in the diff (test vectors only)
