# Tasks

## 1. Copy and reference

- [x] 1.1 Write failing unit tests in `test/ui/write-errors.test.tsx`:
  - `messageFor(SPONSORSHIP_REFUSED, 'create')` is the create copy, and the edit copy is unchanged;
  - `errorReference` extracts the JSON-RPC code and message from a nested viem-style cause, elides hex > 8 characters, strips URLs, and caps the length;
  - the create flow shows the copy and a Details disclosure with `SPONSORSHIP_REFUSED`.

  Then implement them.
- [x] 1.2 Extend E2E `40-errors.spec.ts`: a refusal during the FIRST create shows the create copy and a Details reference with `SPONSORSHIP_REFUSED`. Verify the edit-refusal test still shows "Saving is paused".

## 2. Review

- [x] 2.1 Security review: the reference can't leak the bundler API key, signatures, PRF output or calldata. Record it in `apps/web/docs/security-review-write-feedback.md`.
