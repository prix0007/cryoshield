# Tasks

## 1. License
- [x] 1.1 Add the root `LICENSE` (MIT, "Copyright (c) 2026 CryoShield contributors"). Verify: the file exists and the text is the standard MIT license.
- [x] 1.2 Add `"license": "MIT"` to the root and `apps/web` `package.json`. Verify: a license-consistency script (`scripts/check-licenses.sh`) lists every first-party declaration as MIT, and exits non-zero on a mismatch or missing field.
- [x] 1.3 Run the license check in the CI `openspec` job. Verify: actionlint is clean, and the script passes locally.

## 2. Mainnet decision
- [x] 2.1 Record "Mainnet: OP Mainnet (decided 2026-10-02); deploy only to OP Sepolia until funded" in `openspec/config.yaml`, the PRD decisions log and open questions, and the README. Verify: `openspec validate --all --strict`.

## 3. CI fix
- [x] 3.1 Build `@cryoshield/vault-crypto` before the `web` job's typecheck. Verify: reproduced in a clean worktree (typecheck fails without the build and passes with it), then lint, test, test:int and verify-build all pass from a clean checkout.

## 4. Review
- [x] 4.1 Security review of the diff: no secrets, the CI permissions are unchanged, and the license check can't be bypassed. Verify: reviewer APPROVE.
