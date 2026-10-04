# Proposal

## Why

The founder asked for "a CI pipeline which ACKs the issue when anyone creates it, and have a CI agent diagnose it and update the issue". The repository is public and CryoShield guards seed phrases, so issues carry two specific risks:
- users may paste secrets (seed phrases, recovery codes, keys);
- users may report vulnerabilities in public.

Both must be caught **before** any text reaches a model, and before anything is echoed back.

## What Changes

- **`.github/workflows/issue-triage.yml`** runs on `issues: [opened]`, and on an OWNER-only `/triage` comment to re-run. It skips pull requests, bots, and issues opened by `github-actions[bot]`.
  - **`ack`** (no secrets, `issues: write`): posts one acknowledgement comment, marked `<!-- cryoshield-triage-ack -->`. It is idempotent.
  - **`screen`** (no model) runs the tested `.github/scripts/triage.mjs` on the title and body, plus the pinned gitleaks CLI:
    1. **Sensitive content** (a BIP39 sequence of 12 or more words from the pinned English wordlist, 64-hex key shapes, xprv/xpub, WIF, TOTP secrets or `otpauth://` URIs, or any gitleaks rule): post a fixed warning, label `sensitive-content`, and stop. The matched text is never echoed.
    2. **Vulnerability report** (a conservative keyword heuristic): post a fixed pointer to private vulnerability reporting, label `security`, and stop.
    3. **Privacy request** (template label): stop. A human handles it.
    4. **Cost caps:** at most 20 diagnoses a day repo-wide, and 1 per author per hour (OWNER exempt). Over a cap, the issue is labelled `needs-triage` with a "queued for maintainer review" note.
  - **`diagnose`** uses the hardened `ecc-review.yml` pattern:
    - pinned `claude-code-action` and ECC plugin (hooks off, `.mcp.json` removed);
    - bubblewrap with the env scrub;
    - a read-only default-branch checkout;
    - the issue saved to files;
    - the agent has no Bash or GitHub access and writes only `diagnosis.md` and `labels.txt`.

    A separate step posts the diagnosis, marked `<!-- cryoshield-triage -->`, after credential and BIP39 guards. A re-run updates that comment in place. Labels come only from a fixed allowlist.
- **Workflow policy:** `issue-triage.yml` joins the privileged profile:
  - only its own triggers;
  - per-job `issues: write`;
  - required job conditions;
  - default-branch checkout only (never PR code);
  - digest-pinned run steps;
  - exact agent tool lists;
  - non-`GITHUB_TOKEN` secrets only in `diagnose`.

  The `issues` trigger becomes privileged, which means forbidden everywhere else.
- **Labels** are created by `apply.sh`: the allowlist, plus `sensitive-content`, `security` and `needs-triage`.
- **Issue templates:** bug and feature templates (new) and the privacy-request template get a bold "Never post seed phrases, recovery codes, PINs or keys" line. CLAUDE.md gets an "Issue triage" section, and the README a line.
- **Runtime dependencies: none.** This is CI only, not a CryoShield-operated backend.
- **CI dependencies:** the same pins as `ecc-review.yml` and `ci.yml` (claude-code-action v1.0.240, ECC v2.2.3, gitleaks 8.30.1), and the existing `CLAUDE_CODE_OAUTH_TOKEN` secret. Issue text that passes the screen is sent to Anthropic's API.

**Out of scope:**
- deleting or redacting issues automatically (needs admin; maintainers do it);
- triaging pull requests;
- non-English seed wordlists;
- auto-closing issues.

## Capabilities

### New Capabilities
- `issue-triage`: automatic acknowledgement, secret and vulnerability pre-screening, capped AI diagnosis of new issues, and safe posting.

### Modified Capabilities
- `ci-pipeline`: adds a requirement covering the issue-triggered privileged workflow (an ADDED requirement, because `adopt-ecc-review-and-auto-merge` still has the supply-chain requirement open).

## Impact

- **New:**
  - `.github/workflows/issue-triage.yml`;
  - `.github/scripts/triage.mjs`;
  - `.github/scripts/data/bip39-english.txt`;
  - the tests;
  - `.github/ISSUE_TEMPLATE/{bug,feature}.yml`.
- **Edited:**
  - `workflow-policy.mjs`, `privileged-run-steps.json`, `zizmor.yml`;
  - `apply.sh` (labels);
  - the privacy-request template;
  - `CLAUDE.md` and `README.md`.
- **Model cost:** at most 20 diagnoses a day.
