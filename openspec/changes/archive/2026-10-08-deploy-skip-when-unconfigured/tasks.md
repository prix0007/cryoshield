# Tasks

## 1. Config check (tests first)

- [x] 1.1 Write `test/deploy-config.test.mjs` first. It covers:
  - fully configured, unconfigured and partially configured states;
  - a malformed flag failing loudly;
  - `REQUIRED` matching `write-env.sh`;
  - the job structure (presence flags only, `test` and `build` gated);
  - the policy (the presence form is allowed only for `VITE_BUNDLER_URL` in `config`; a raw secret or the Fly token is refused).

  Then write `check-config.sh`, the `config` job and the policy change.

## 2. Fly token message (tests first)

- [x] 2.1 Add a test that `previous-image.sh` fails with a `deploy not configured` error on an empty `FLY_API_TOKEN`, before calling fly. Then implement it.

## 3. Docs and integration

- [x] 3.1 Update `docs/deploy.md`. Run `npm test`, the policy check, actionlint, zizmor (with the moved line pin), shellcheck, `openspec validate --all --strict` and gitleaks on the range.

## 4. Security review

- [x] 4.1 The security reviewer reviews this change, covering: (Done: APPROVE recorded in the "Security review" section of PR #29.)
  - that no secret value reaches the config step;
  - the policy exception's scope;
  - that a skip can't hide a real failure or bypass CI before a deploy;
  - the retry behaviour.

  Verify by recording an APPROVE, or the findings plus fixes, in `design.md`.
