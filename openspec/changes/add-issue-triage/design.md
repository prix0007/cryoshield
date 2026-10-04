# Design

## Context

- `ecc-review.yml` (on `main`) is the hardened template for running an agent on untrusted text:
  - pinned action and plugin;
  - plugin hooks off and `.mcp.json` removed;
  - bubblewrap with the env scrub;
  - no Bash, exact tool lists, writes to two files only;
  - a separate posting step with a credential guard;
  - an OWNER-only re-run.
- `workflow-policy.mjs` enforces that pattern for named privileged workflows, with run steps pinned in `privileged-run-steps.json`.
- The repository is public. Anyone can open an issue, and the `issues` and `issue_comment` events run with secrets.

## Goals / Non-Goals

**Goals:**
- An acknowledgement within a minute.
- Secrets never echoed and never sent to the model.
- Vulnerability reports routed privately.
- A grounded first diagnosis at bounded cost.

**Non-Goals:**
- Automatic deletion or redaction (needs admin, and GitHub keeps edit history anyway).
- PR triage.
- Non-English wordlists.

## Decisions

### 1. One workflow with three jobs and one concurrency group per issue

The concurrency group is `issue-triage-<number>` and is never cancelled. Every job's condition ANDs:
- `!github.event.issue.pull_request`;
- `github.event.sender.type != 'Bot'`;
- `github.event.issue.user.login != 'github-actions[bot]'`.

The jobs are:

**`ack`** (`issues: write` only, no checkout, `GITHUB_TOKEN` only)
- Runs on `issues` events.
- It lists the issue's comments and posts the fixed acknowledgement only if no `github-actions[bot]` comment already carries `<!-- cryoshield-triage-ack -->`.

**`screen`** (`contents: read`, `issues: write`)
- Trigger: `issues` opened, or an `issue_comment` starting with `/triage` from the OWNER. The trigger rule is one exact parenthesised conjunct, which the policy requires.
- It checks out the default branch at the event's default commit (no `ref`, credentials not persisted), and only `.github/scripts`.
- It writes title and body to a file through `env:`, never interpolating them.
- It runs gitleaks 8.30.1 (pinned and checksummed, as in `ci.yml`) with `--redact` and all output discarded, keeping only the exit code. Then it runs `node .github/scripts/triage.mjs screen`, which prints only `{verdict, reasons}`.
- It acts on the verdict with **fixed** texts (decision 3).
- If the verdict is `ok`, it evaluates the caps (decision 5).
- Output: `verdict`.

**`diagnose`** (`contents: read`, `issues: write`)
- Runs only when `screen.verdict == 'ok'`.
- It follows `ecc-review.yml`: default-branch checkout, `.ecc-plugin` removal, a pinned ECC checkout that is verified and moved out of the workspace, emptied `hooks.json`, removed `.mcp.json`, and bubblewrap.
- It collects the issue (title, body, labels, author association, last 20 comments) to files with `gh`.
- The `claude-code-action` step runs with:
  - `--allowedTools "Agent,Read,Grep,Glob,Edit(//home/runner/work/_temp/triage/diagnosis.md),Edit(//home/runner/work/_temp/triage/labels.txt)"`;
  - the same `--disallowedTools` as the review;
  - `ECC_HOOKS_ENABLED=false` and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`;
  - `REVIEW_MODEL`.
- Posting:
  - `triage.mjs guard` refuses credential shapes and BIP39 sequences in the output;
  - `triage.mjs labels` keeps only allow-listed labels;
  - the comment is created, or updated in place (decision 6);
  - labels are added.

### 2. Pre-screen rules (`.github/scripts/triage.mjs screen`, no model)

The sensitive rules, any of which matches:
- **BIP39:** the text is lower-cased and tokenised on letters only. Digits, punctuation and line breaks separate tokens, so numbered lists and phrases split across lines still match. A run of **12 or more consecutive** tokens that are all in the pinned English wordlist matches.
  - Every valid length (12, 15, 18, 21, 24) contains a 12-run.
  - The checksum is **not** required, because a typo'd phrase is still a leaked phrase.
  - The wordlist is `.github/scripts/data/bip39-english.txt`: 2048 words, SHA-256 `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda` (bitcoin/bips `bip-0039/english.txt`). Its hash is checked at load, and any mismatch fails closed.
- **64-hex** (`0x` optional), **except inside an http(s) URL.** A transaction link to a block explorer is fine; a bare 64-hex string could be a private key and is flagged.
  - This applies inside code blocks too, because code blocks are where keys get pasted.
  - **Commit hashes (40-hex) do not trigger**, nor do addresses (40-hex), short hashes or 32-hex IDs.
  - A reporter pasting a bare transaction hash gets the warning. This false positive is accepted, and the warning says to post explorer links instead.
- **Extended keys:** `[xyztuv](prv|pub)` followed by 100–108 base58 characters. xpubs are flagged too, because they reveal wallet history.
- **WIF:** `5[HJK]` + 49 base58 characters, or `[KL]` + 51 base58 characters (mainnet), and `c` + 51 (testnet).
- **TOTP:** `otpauth://` anywhere; `secret=` followed by 16 or more base32 characters; or a line mentioning `totp|2fa|authenticator|backup code|recovery code` together with a 16+ base32 run or a `xxxx-xxxx` style code group.
- **gitleaks:** any default rule (the exit code is passed in).

Security rules: one **strong** keyword or phrase (word-bounded, case-insensitive), for example `vulnerability`, `exploit`, `CVE-`, `security issue`, `security bug`, `XSS`, `CSRF`, `RCE`, `remote code execution`, `privilege escalation`, `bypass`, `injection`, `0-day`, `zero-day`, `drain`, `steal`, `exfiltrat*`, `phishing`, `attacker`.
- "Conservative" here means **fail toward private handling**: a false positive only costs a maintainer removing the label.
- Generic words (`bug`, `security key`, `crash`, `error`) never trigger. "security key" is CryoShield's main feature.

The screen also returns `privacy` when the issue has the `privacy-request` label: a human handles it, with no model involved.

The screen never returns matched text. Its CLI prints only JSON with a verdict and reason **codes**, and the workflow logs only the verdict.

### 3. Fixed texts (reviewed for accuracy)

All three texts are constants in `triage.mjs`, and tests assert them. The markers lead each comment.

**Sensitive** (`<!-- cryoshield-triage-sensitive -->`):
- It says the issue appears to contain secret material, and that the comment will not repeat it.
- **Remove it now** by editing the issue. Because GitHub keeps an edit history that others can read, a maintainer will delete the whole issue; the reporter should open a new one without the secret.
- **Treat it as compromised:** if it was a wallet seed phrase or private key, move any funds to a new wallet created with a new seed phrase now. If it was a 2FA secret or recovery code, regenerate it at that service.
- Maintainers will never ask for seed phrases, recovery codes, PINs or keys.

This is accurate for CryoShield: vault ciphertext is safe, but a posted plaintext secret is public forever.

**Security** (`<!-- cryoshield-triage-security -->`): report privately via `https://github.com/prix0007/cryoshield/security/advisories/new` (private vulnerability reporting is enabled), as `SECURITY.md` asks. Edit out exploit details here. A maintainer will review, and if it is not a vulnerability will remove the label and triage it normally.

**Queued** (`<!-- cryoshield-triage-queued -->`): automatic triage is at capacity, so the issue is queued for maintainer review.

### 4. Agent output and posting

- `diagnosis.md` is posted verbatim after the guard. Its first line is `<!-- cryoshield-triage -->`, prepended by the step, never trusted from the agent. Then come one hidden run marker per diagnosis, `<!-- cryoshield-triage-run: <ISO> author=<login> -->` (the previous ones are kept), and a footer.
- `labels.txt` is split on commas and newlines, trimmed and lower-cased, and anything outside the allowlist is dropped. At most 5 labels are applied.
- The guard refuses to post when the output contains any of these:
  - a credential shape (`sk-ant-`, `gh[pousr]_`, `github_pat_`, `-----BEGIN … PRIVATE KEY-----`);
  - the exact `CLAUDE_CODE_OAUTH_TOKEN`;
  - a BIP39 run;
  - 64-hex outside URLs;
  - an xprv, WIF or `otpauth`.

  The run then fails loudly, with no partial post.

### 5. Caps (`triage.mjs caps`, pure function plus a small data-collection step)

- **Data:** `github-actions[bot]` comments on issues, updated since `min(today 00:00Z, now - 1h)`, carrying run markers (`gh api --paginate repos/R/issues/comments?since=…`). Only bot-authored comments count, so users cannot inflate or forge the counts.
- **Daily cap:** markers dated today (UTC) ≥ `DAILY_CAP` (20) → capped.
- **Per-author cap:** markers with `author=<issue author>` within the last hour ≥ 1 → capped. Exempt: issues authored by the OWNER, and OWNER `/triage` re-runs.
- **Owner re-runs** also bypass the daily cap: the owner chooses to spend.
- **Over a cap:** label `needs-triage` and post the queued note once (idempotent by marker).

### 6. Re-runs update in place

The posting step looks for an existing `github-actions[bot]` comment starting with `<!-- cryoshield-triage -->`. If one exists it PATCHes it, keeping its run markers and adding a new one; otherwise it creates a new comment. The acknowledgement is never re-posted.

### 7. Policy (`workflow-policy.mjs`)

- `issues` joins `PRIVILEGED_TRIGGERS`.
- `issue-triage.yml` gets a profile:
  - triggers `issues` and `issue_comment`;
  - write scopes `ack: issues`, `screen: issues`, `diagnose: issues`;
  - exact required conjuncts per job;
  - `checkout: 'default-branch'`: no `ref` and no `repository` other than the env-pinned plugin, with `persist-credentials: false`;
  - `trustedScripts`: `node .github/scripts/triage.mjs …` is allowed, because the checkout is the default branch;
  - `agentTools` with the exact triage tool lists;
  - `secretJobs: ['diagnose']`: non-`GITHUB_TOKEN` secrets are allowed only there;
  - the hooks-off line is required.
- Fork-refusal rules (PR-specific) do not apply to issue events, which carry no PR code. Instead, the "no PR" conjunct is required.
- Privileged conditions now use `splitCondition`. A top-level `||` is still rejected, but the exact parenthesised trigger conjunct is allowed.
- Every run step is pinned in `privileged-run-steps.json`.

### 8. Pins

The same pins as `ecc-review.yml` and `ci.yml`, already verified:
- `actions/checkout` v7.0.1 `3d3c42e5…`;
- `anthropics/claude-code-action` v1.0.240 `ed670b4c…`;
- ECC v2.2.3 `c05b2d66…`;
- gitleaks 8.30.1 sha256 `551f6fc8…`.

Node is the runner's preinstalled Node. `triage.mjs` uses only built-ins and runs on Node 20 or later.

## Threats / abuse

| Threat | Mitigation |
|---|---|
| A user posts a seed phrase | It is caught before the model, never echoed (logs show only the verdict), and gets a fixed warning plus a label. A maintainer deletes the issue. |
| Prompt injection in the issue | The agent has no shell, network or GitHub access, and writes two files only. Posting is done by a step with guards. Labels come only from the allowlist. The worst case is a misleading diagnosis comment, which is clearly marked as automatic. |
| A secret exfiltrated through the agent's output | The env is scrubbed under bubblewrap. The output guard covers credential shapes, the exact OAuth token, and BIP39 and key shapes. |
| Cost abuse (issue spam) | 20 a day repo-wide, 1 per author per hour. Counts come from bot-authored markers only. Concurrency is per issue. |
| A non-owner triggers re-runs | `/triage` requires `author_association == 'OWNER'`. |
| Workflow edited to check out PR code | Policy: default-branch checkout only, and the "no PR" conjunct is required. |
| Template injection through the issue title or body | Values pass only through `env:`. zizmor's template-injection audit is on. |
| A bot or Actions loop | Bots are skipped. Comments made with `GITHUB_TOKEN` trigger no workflows. |

## Risks / Trade-offs

- **Bare 64-hex transaction hashes trigger the sensitive warning.** This is accepted; the warning tells the reporter to post explorer links instead.
- **An English paragraph made of 12 consecutive BIP39 words** would trigger. This is extremely rare in practice, and a near-miss test covers it.
- **The security heuristic will have false positives,** which a maintainer clears.
- **The model sees issue text that passed the screen.** The reporter's GitHub content is public anyway.

## Security review (2026-10-04): REJECT, then fixed

Every fix below was test-first. The regression tests are in `test/triage-review.test.mjs` and `test/issue-triage-workflow.test.mjs`, and the gitleaks self-test runs the real binary.

### HIGH

1. **gitleaks 8.30.1 failed on every run.** With `--report-path /dev/null` it could not infer a report format, so it exited fatally with code 1, the same code as a leak. Every issue would have been flagged as sensitive.
   - Fix: `--report-format json --report-path <tmp>` (deleted straight after) and `--exit-code 42`. `screen` accepts only 0 (clean) and 42 (leak); any other code fails closed.
   - `gitleaks-selftest.sh`, which runs in `pr-checks` with the pinned binary, now also runs the exact triage invocation. Clean text must exit 0 and a leak 42.
2. **The caps could be bypassed** by racing simultaneous issues, or by forcing runs to fail.
   - Fix: the caps step **reserves** before diagnosing. It writes our run marker, now with `issue=N`, into the triage comment as an "in progress" placeholder, so failed runs count too. It then re-checks counting only markers **earlier** than ours (by time, then issue number). If capped after reserving, the reservation is removed and the issue gets `needs-triage`.
   - The final post keeps the reservation marker and adds none (`--no-run-marker`), so nothing is counted twice.

### MEDIUM

1. **Run markers could be forged** with nested comments. Fixes:
   - HTML comments are now stripped repeatedly until none remain, and any leftover `<!-`/`->` delimiters are removed;
   - markers are parsed only from the block after the footer.
2. **The diagnose re-screen skipped gitleaks.** Fix: diagnose now installs the pinned gitleaks. `triage.mjs split` writes the issue and each comment to their own files, gitleaks scans them, and `prepare --gitleaks-report` withholds flagged comments or aborts on a flagged issue (exit 3). The temporary files are deleted before the agent runs.
3. **`display_report: true` published unchecked output.** Fix: it is now `false`, and the policy requires that for the triage agent.
4. **The guard did not stop phishing-style output.** Fixes:
   - links are allowed only to `https://github.com/prix0007/cryoshield/...`, `https://cryoshield.app` and `https://docs.github.com` (otherwise `foreign-link`);
   - un-negated sentences asking someone to enter, post, share or send a phrase, words, PIN, seed or similar are refused (`secret-request`);
   - `@mentions` are wrapped in code spans, so they never ping anyone.

### LOW

1. **Pre-screen evasions.** Fixed: the text is NFKC-normalised and format characters (`\p{Cf}`: zero-width spaces, soft hyphens) are removed. 64-hex written in groups of four with separators is caught, and URL query strings and fragments are scanned (only scheme, host and path are exempt).
   - **Accepted residual risk,** documented here: words joined with no spaces, Cyrillic look-alikes that NFKC does not fold, base64-encoded keys (indistinguishable from Arweave transaction IDs, which this app uses), phrases of fewer than 12 words, and non-English wordlists.
2. **Comments were not paginated.** Fixed: they are fetched with `--paginate`, and the last 20 kept.
3. **Run-step `env` was not pinned.** Fixed: privileged workflows may not set interpreter-hijacking env keys (`NODE_OPTIONS`, `BASH_ENV`, `ENV`, `LD_*`, `DYLD_*`, `PATH`, `PYTHONPATH`, `GIT_*` and similar) at workflow, job or step level.
4. **`apply.sh` parsed `labels.json` with tab separators.** Fixed: it uses the ASCII unit separator, so empty fields are kept and tabs in descriptions are not mangled.

## Re-review (4dac9fb): APPROVE WITH FIXES, all fixed

Every fix was test-first, and the gitleaks behaviour was checked with the real 8.30.1 binary.

- **M-a:** a negation exempts a request for secrets only when it directly precedes the request verb ("never share", "do not post", "don't paste"). "Do not hesitate to paste your seed words" is refused.
- **M-b:** the link allowlist also covers `www.` hosts (GitHub autolinks them), protocol-relative `](//…)` links, and `href`/`src` attributes.
- **L-a:** the secret-noun list is narrower: "recovery/seed/backup phrase|words|codes", "N words", seed, mnemonic, PIN, keys, passphrase, 2FA codes. "Recovery tool" no longer triggers. The prompt tells the agent exactly which links are allowed.
- **L-b:** both triage scans use `--ignore-gitleaks-allow`. The self-test proves an inline `gitleaks:allow` still exits 42.
- **L-c:** if the issue changes after the screen and no longer passes it, `diagnose` posts the fixed sensitive or security notice and label, deletes the in-progress placeholder, and fails loudly. `prepare` fails closed when gitleaks reports a leak (42) that it cannot match to a file.
- **Accepted:** a run that reads the clock earlier but reserves later can slip past the cap by a few seconds.
