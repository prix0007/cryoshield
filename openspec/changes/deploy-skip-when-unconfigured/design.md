# Design

## Decisions

### 1. A separate `config` job before the full CI, not a step in `build`

The check needs the `production-build` environment, so it can't live in `detect`.

Putting it at the start of `build` would still run the full `ci.yml` (E2E included) every 15 minutes while unconfigured, because `/release.json` doesn't exist yet, so `detect` always says "deploy". Any flaky test failure there would turn `main` red again.

A small job between `detect` and `test` avoids both. Its cost is one short `production-build` deployment record per scheduled run while unconfigured.

### 2. Presence flags, never values

The step env holds `${{ vars.X != '' }}` and `${{ secrets.VITE_BUNDLER_URL != '' }}`. GitHub evaluates these to `true` or `false`, so the secret never reaches the step or its process environment.

The policy allows this exact form only for `VITE_BUNDLER_URL`, in step `config`, in a `production-build` job. The script's `REQUIRED` list must equal `write-env.sh`'s; a test asserts this, and also that the workflow passes exactly those flags. `write-env.sh` keeps its own hard check as a backstop.

### 3. Skip = success; a broken check = failure

When configuration is missing, the outcome is a warning with `configured=false`, and the run succeeds. A missing or malformed `HAS_*` flag means the workflow and the script drifted apart, so it exits 2 and fails loudly. Otherwise the pipeline could skip forever without anyone noticing.

### 4. Retries

`detect` treats only `failure` conclusions as "previously failed", and skipped runs conclude `success`. A commit is therefore retried normally once configured: on the next scheduled run, on the next merge, or with `workflow_dispatch force=true`.

Runs that already failed before this change only affect their own commit. Merging this PR creates a new one.

### 5. `FLY_API_TOKEN`

The token is only readable inside the approved `production` job, so it can't be checked earlier without an approval. `previous-image.sh` runs first after approval, and now fails with a clear `deploy not configured` error before any flyctl call. No release-job run step changed, so the digest pins are unchanged.

## Risks / Trade-offs

- While unconfigured, each run shows a warning annotation but no failure. Someone who doesn't look at warnings may not notice that nothing deploys. `docs/deploy.md` and the job summary say so.
- `vars.X != ''` treats a whitespace-only value as present. `write-env.sh` still rejects bad values in `build`, which fails loudly, and that is correct for a real misconfiguration.
