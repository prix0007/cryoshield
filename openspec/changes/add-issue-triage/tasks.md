# Tasks

## 1. Pre-screen, guard, labels and caps (tests first)

- [x] 1.1 Bundle `.github/scripts/data/bip39-english.txt`, hash-pinned. Write `test/triage.test.mjs` first:
  - a 12-word phrase split across lines and numbered;
  - 15-, 18-, 21- and 24-word phrases;
  - an 11-word near miss and ordinary English text;
  - 64-hex bare, in a code block, and inside an explorer URL;
  - a 40-hex commit hash;
  - xprv/xpub;
  - WIF;
  - `otpauth://`;
  - TOTP-labelled base32;
  - a gitleaks exit code;
  - the security keywords, plus negatives ("security key", "bug");
  - the privacy label;
  - an injection attempt;
  - no matched text in the output;
  - wordlist tamper fails closed.

  Then implement `triage.mjs screen`. Verify with `npm test --prefix .github/scripts`.
- [x] 1.2 Tests first for `guard` (credential shapes, the exact token, BIP39) and `labels` (allowlist, at most 5, injection), then implement them. Verify with `npm test`.
- [x] 1.3 Tests first for `caps`:
  - daily 20 limit;
  - per-author per hour;
  - owner exemptions;
  - markers from non-bot comments ignored;
  - UTC day boundary.

  Then implement it. Verify with `npm test`.

## 2. Workflow and policy

- [x] 2.1 Add `.github/workflows/issue-triage.yml` (decisions 1, 3–6). Verify that actionlint is clean.
- [x] 2.2 Tests first in `test/issue-triage-workflow.test.mjs`:
  - another workflow using `issues`;
  - a checkout with a `ref` or a persisting checkout;
  - a missing no-PR or no-bot conjunct;
  - a non-owner `/triage`;
  - a secret outside `diagnose`;
  - wrong tool lists;
  - hooks on;
  - an unpinned run step;
  - a top-level `||`.

  Then extend `workflow-policy.mjs` and pin the digests. Verify that `npm test` is green, the policy is OK, and zizmor pedantic is clean.

## 3. Labels, templates, docs

- [x] 3.1 `apply.sh` creates the allowlist labels plus `sensitive-content`, `security` and `needs-triage`, with tests in `apply-sh.test.mjs`. Verify with `npm test` and shellcheck.
- [x] 3.2 Bug and feature templates (new) and the privacy-request template carry the bold warning line (test). Add the CLAUDE.md "Issue triage" section and the README line. Verify with `npm test`.

## 4. Integration

- [x] 4.1 Run the full suite and verify that all are green:
  - `npm test --prefix .github/scripts`;
  - actionlint;
  - zizmor pedantic;
  - the policy;
  - shellcheck;
  - `openspec validate --all --strict`;
  - the licence check;
  - gitleaks on the range (the wordlist must not trigger).

## 5. Security review

- [ ] 5.1 The security reviewer reviews this change, covering:
  - the trigger and actor gating;
  - the secret-leak paths (logs, comments, model input, labels, artifacts);
  - pre-screen completeness and its false-negative modes;
  - prompt injection;
  - the posting guard;
  - cap integrity (can anyone forge or inflate the counts?);
  - the policy exception for `issues` and the default-branch checkout;
  - fixed-text accuracy.

  Verify by recording an APPROVE, or the findings plus fixes, in design.md.
