# Spec Delta

## MODIFIED Requirements

### Requirement: Smoke test and automatic rollback per target
After every deployment, the pipeline SHALL verify the target's live site:
- `/`, `/app/`, `/architecture`, `/devices`, `/support`, `/privacy` and `/healthz` return 200;
- the security headers are present;
- `/` sends a Permissions-Policy with `publickey-credentials-get=()` and `publickey-credentials-create=()`, and `/app/` one with `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)`;
- `/architecture` shows the registry address from `contracts/deployments/<chainId>.json`, and every registry listed in
  `/release.json`'s `config.registries`;
- `/release.json`'s `config.registries` is newest first with unique versions, its v1 and v2 entries equal the record,
  and, when the expected list is given, it equals that list exactly;
- `/support` shows the configured donation address only;
- `/release.json` reports the deployed commit, and its `treeHash` equals the tree hash the build job published as a job output;
- `/release.json` `release` is `null` on development, and on production a well-formed `vX.Y.Z[-prerelease]` name equal to the tag the run deployed (the run's own tag ref, or `EXPECT_RELEASE` when set; a malformed expectation is a usage error, never a skipped check).

On development, every page MUST carry `X-Robots-Tag: noindex, nofollow`. On production, no page may carry a noindex header. On any failure, the pipeline MUST redeploy the target's previously live image and then fail the run.

#### Scenario: Dev Caddyfile on production
- **WHEN** a production release serves `X-Robots-Tag: noindex`
- **THEN** the smoke test fails, the previous production image is redeployed, and the run fails

#### Scenario: Landing page gains WebAuthn
- **WHEN** a release serves `/` with `publickey-credentials-get=(self)`, or `/app/` with `publickey-credentials-get=()`
- **THEN** the smoke test fails, the previous image is redeployed, and the run fails

#### Scenario: Live tree differs from the build
- **WHEN** the live `/release.json` `treeHash` differs from the build job's `tree_hash` output
- **THEN** the smoke test fails, the previous image is redeployed, and the run fails

#### Scenario: Live release name differs from the tag
- **WHEN** a production run at tag `v1.2.3` finds `/release.json` `release` to be `null`, malformed or another name, or a development run finds it to be anything but `null`
- **THEN** the smoke test fails, the previous image is redeployed, and the run fails

#### Scenario: Registry missing from the architecture page
- **WHEN** `/release.json` lists a registry whose address `/architecture` doesn't show
- **THEN** the smoke test fails and the previous image is redeployed
