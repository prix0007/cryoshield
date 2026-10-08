# Spec Delta

## MODIFIED Requirements

### Requirement: Smoke test and automatic rollback per target
After every deployment, the pipeline SHALL verify the target's live site:
- `/`, `/app/`, `/architecture`, `/devices`, `/support`, `/privacy` and `/healthz` return 200;
- the security headers are present;
- `/architecture` shows the registry address from `contracts/deployments/<chainId>.json`, and every registry listed in
  `/release.json`'s `config.registries`;
- `/release.json`'s `config.registries` is newest first with unique versions, its v1 and v2 entries equal the record,
  and, when the expected list is given, it equals that list exactly;
- `/support` shows the configured donation address only;
- `/release.json` reports the deployed commit.

On development, every page MUST carry `X-Robots-Tag: noindex, nofollow`. On production, no page may carry a noindex header. On any failure, the pipeline MUST redeploy the target's previously live image and then fail the run.

#### Scenario: Dev Caddyfile on production
- **WHEN** a production release serves `X-Robots-Tag: noindex`
- **THEN** the smoke test fails, the previous production image is redeployed, and the run fails

#### Scenario: Registry missing from the architecture page
- **WHEN** `/release.json` lists a registry whose address `/architecture` doesn't show
- **THEN** the smoke test fails and the previous image is redeployed
