<!--
Title: Conventional Commits, e.g. `feat(web): add key enrolment screen` (CI checks it; it becomes the squash commit).
Branch: feat/…, fix/…, ci/…, docs/…, chore/…
-->

## OpenSpec change

<!-- Name of the change this PR implements, proposes or archives: `openspec/changes/<name>`.
     Code changes without a change fail CI unless the PR has the `no-spec` label AND the line below is filled in. -->
Change: 

No-spec justification: 

## Summary

<!-- What and why, in a few bullets. -->

## Tests run

<!-- Commands you ran and their result, e.g. `pnpm --filter @cryoshield/web test` (pass). -->
- 

## Security review

<!-- Link to the review record (docs/reviews/…, design.md section) for changes touching crypto, contracts,
     the paymaster, secret handling or CI. Otherwise write N/A. -->
Review: 

## Screenshots (UI changes)

<!-- Before/after for any visible change in apps/web. Otherwise write N/A. -->

## Checklist

- [ ] OpenSpec tasks ticked in `tasks.md`
- [ ] Tests added first (TDD) and passing locally
- [ ] No secrets, keys or real seed phrases in the diff (test vectors only)
