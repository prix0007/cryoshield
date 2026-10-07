#!/usr/bin/env node
// Workflow security policy (OpenSpec change adopt-pr-workflow, decision 9; spec: ci-pipeline
// "CI supply-chain security"). Complements zizmor instead of duplicating it:
//   here:   no workflow_run; pull_request_target/issue_comment/issues only in the PRIVILEGED files below, which must keep
//           their guards (fork refusal, owner-only comments, no PR code executed, head checkout read-only and only in
//           ecc-review, allow-listed actions and per-job write scopes); everywhere else top-level permissions exactly
//           `contents: read` (or {}), read-only job permissions, timeout-minutes, no secrets context in PR-triggered
//           workflows; no inline `zizmor: ignore`; zizmor.yml keeps hash-pin for "*" and ignores only
//           dangerous-triggers on the privileged files' trigger lines and self-repository on the deploy workflows.
//   deploy: (add-continuous-deploy D7, split-dev-and-release-deploys D7) one profile per deploy workflow (DEPLOY_PROFILES):
//           deploy.yml (production: published v* release or owner dispatch; owner + ref gate on the first job; only
//           production/production-build) and deploy-dev.yml (development: push(main)/schedule/dispatch; first job on
//           refs/heads/main; only development/development-build). Each: exact never-cancelled concurrency, one release
//           job with its own never-cancelled group and a re-check before `deploy`, FLY_API_TOKEN only in the step env of
//           steps `deploy`/`rollback` of that job, no write scopes, digest-pinned token-job run steps. No other workflow
//           may use FLY_API_TOKEN or any deploy environment. zizmor: self-repository once per deploy workflow:<line>.
//   author gate: (gate-external-pr-automation) ecc-review and auto-merge run automatically only for trusted authors
//           (repository owner, or .github/trusted-authors.json read from the default branch): an exact, unconditional
//           gate step at a fixed position (authorGate below), and a valid trusted-authors.json.
//   scheduled read-only: (add-privacy-preserving-analytics 2.2) SCHEDULED_READ_ONLY workflows run only on schedule and
//           input-less workflow_dispatch, reference no secrets or github.token, hold only contents: read, never persist
//           checkout credentials, use no environment or custom shell, use only allow-listed actions and run only
//           allow-listed programs; metrics.yml must upload its report with upload-artifact and retention-days <= 90.
//   zizmor: SHA pinning (via that hash-pin policy), persist-credentials (artipacked), template injection, etc.
//
// CLI: node workflow-policy.mjs [<.github dir>]   (default: .github)  exit 0 ok, 1 violations.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const FORBIDDEN_TRIGGERS = ['workflow_run'];
// Triggers that run with secrets and a write-capable token on PR/comment events, whoever authored them.
// `issues` too: any account can open an issue, and the run has secrets (add-issue-triage D7).
const PRIVILEGED_TRIGGERS = ['pull_request_target', 'issue_comment', 'issues'];

// The only workflows allowed to use privileged triggers (OpenSpec change adopt-ecc-review-and-auto-merge,
// design decision 3, hardened after its security review). Per file: allowed triggers, per-job write scopes,
// required job-condition conjuncts, whether it may check out the PR head (read only), and, for the review step,
// the exact agent tool lists and env. Every run step is pinned by SHA-256 in privileged-run-steps.json.
const SAME_REPO = 'github.event.pull_request.head.repo.full_name == github.repository';
const FORK = 'github.event.pull_request.head.repo.full_name != github.repository';
const OWNER_ONLY = "github.event.comment.author_association == 'OWNER'";
const NOT_DRAFT = 'github.event.pull_request.draft == false';
const DEFAULT_BASE = 'github.event.pull_request.base.ref == github.event.repository.default_branch';
const NOT_DEPENDABOT = "github.event.pull_request.user.login != 'dependabot[bot]'";
const REVIEW_DIR = '//home/runner/work/_temp/ecc-review';
export const REVIEW_ALLOWED_TOOLS = `Agent,Read,Grep,Glob,Edit(${REVIEW_DIR}/body.md),Edit(${REVIEW_DIR}/verdict.txt)`;
export const REVIEW_DISALLOWED_TOOLS =
  'Bash,WebFetch,WebSearch,Read(//proc/**),Grep(//proc/**),Glob(//proc/**),Read(./.git/**),Grep(./.git/**),Glob(./.git/**)';
// ecc-review reads the PR head from pr/ (harden-codeql-ci-findings): its .git is off limits too.
export const ECC_DISALLOWED_TOOLS = `${REVIEW_DISALLOWED_TOOLS},Read(./pr/.git/**),Grep(./pr/.git/**),Glob(./pr/.git/**)`;
const HOOKS_OFF_LINE = `printf '{"hooks":{}}\\n' > "$RUNNER_TEMP/ecc-plugin/hooks/hooks.json"`;
// Issue triage (add-issue-triage D1/D7).
const TRIAGE_DIR = '//home/runner/work/_temp/triage';
export const TRIAGE_ALLOWED_TOOLS = `Agent,Read,Grep,Glob,Edit(${TRIAGE_DIR}/diagnosis.md),Edit(${TRIAGE_DIR}/labels.txt)`;
const TRIAGE_TRIGGER =
  "(github.event_name == 'issues' || (github.event_name == 'issue_comment' && startsWith(github.event.comment.body, '/triage') && github.event.comment.author_association == 'OWNER'))";
const NOT_PR_ISSUE = '!github.event.issue.pull_request';
const NOT_BOT_SENDER = "github.event.sender.type != 'Bot'";
const NOT_ACTIONS_ISSUE = "github.event.issue.user.login != 'github-actions[bot]'";

// Trusted-author gate (gate-external-pr-automation D1-D4, D8). Only the repository owner and the logins in
// .github/trusted-authors.json (read by the gate from the default branch, never from the PR) get the automatic ECC review
// and auto-merge. The gate's inputs come only through env; its script is digest-pinned like every privileged run step.
export const ECC_GATE_STEP = "Require a trusted author or the owner's /ecc-review approval";
export const AUTO_MERGE_GATE_STEP = 'Require a trusted author (the owner merges other PRs by hand)';
const GATE_AUTHOR = '${{ github.event.pull_request.user.login }}';
const GATE_OWNER = '${{ github.repository_owner }}';
// The pusher/labeler: trust needs both the PR author and the sender (security review H2).
const GATE_SENDER = '${{ github.event.sender.login }}';
const GATE_DEFAULT_BRANCH = '${{ github.event.repository.default_branch }}';
export const TRUSTED_AUTHORS_FILE = 'trusted-authors.json';
const TRUSTED_GUARD = "steps.author.outputs.trusted == 'true'";

export const PRIVILEGED = {
  'ecc-review.yml': {
    triggers: ['pull_request_target', 'issue_comment'],
    writeScopes: { review: ['pull-requests'], rerun: ['actions'] },
    conditions: {
      review: ["github.event_name == 'pull_request_target'", NOT_DRAFT],
      rerun: ["github.event_name == 'issue_comment'", 'github.event.issue.pull_request', "startsWith(github.event.comment.body, '/ecc-review')", OWNER_ONLY],
    },
    headCheckout: true,
    // CodeQL #1: the PR head only in this subdirectory; the workspace root is the base commit.
    headPath: 'pr',
    requiredRunLines: [HOOKS_OFF_LINE],
    agent: { allowedTools: REVIEW_ALLOWED_TOOLS, disallowedTools: ECC_DISALLOWED_TOOLS, allowNonWriteUsers: false },
    // Step 2, right after the fork refusal: before the credential check, every checkout and the model. Fails (exit 1)
    // unless the author is trusted or the owner commented /ecc-review after this run's event (never skipped).
    authorGate: {
      job: 'review',
      step: ECC_GATE_STEP,
      index: 1,
      env: {
        AUTHOR: GATE_AUTHOR,
        SENDER: GATE_SENDER,
        OWNER: GATE_OWNER,
        PR_UPDATED_AT: '${{ github.event.pull_request.updated_at }}',
        DEFAULT_BRANCH: GATE_DEFAULT_BRANCH,
        GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      },
      failClosed: true,
    },
  },
  'auto-merge.yml': {
    triggers: ['pull_request_target'],
    writeScopes: { 'auto-merge': ['contents', 'pull-requests'] },
    conditions: { 'auto-merge': [NOT_DRAFT, SAME_REPO, DEFAULT_BASE, NOT_DEPENDABOT] },
    headCheckout: false,
    requiredRunLines: [],
    // Step 1 (id author) writes trusted=true|false; every later step runs only when it is true.
    authorGate: {
      job: 'auto-merge',
      step: AUTO_MERGE_GATE_STEP,
      index: 0,
      id: 'author',
      env: { AUTHOR: GATE_AUTHOR, SENDER: GATE_SENDER, OWNER: GATE_OWNER, DEFAULT_BRANCH: GATE_DEFAULT_BRANCH },
      guardLaterSteps: TRUSTED_GUARD,
    },
  },
  // Issue events carry no PR code, so the PR fork guard does not apply; instead every job must exclude PRs and bots,
  // checkouts are of the default branch only (no ref), and only `node .github/scripts/triage.mjs` may run from it.
  'issue-triage.yml': {
    triggers: ['issues', 'issue_comment'],
    writeScopes: { ack: ['issues'], screen: ['issues'], diagnose: ['issues'] },
    conditions: {
      ack: ["github.event_name == 'issues'", NOT_PR_ISSUE, NOT_BOT_SENDER, NOT_ACTIONS_ISSUE],
      screen: [TRIAGE_TRIGGER, NOT_PR_ISSUE, NOT_BOT_SENDER, NOT_ACTIONS_ISSUE],
      diagnose: [TRIAGE_TRIGGER, NOT_PR_ISSUE, NOT_BOT_SENDER, NOT_ACTIONS_ISSUE, "needs.screen.outputs.verdict == 'ok'"],
    },
    headCheckout: false,
    defaultBranchCheckout: true,
    forkGuard: false,
    trustedScript: /\bnode \.github\/scripts\/triage\.mjs\b/g,
    secretJobs: ['diagnose'],
    requiredRunLines: [HOOKS_OFF_LINE],
    agent: { allowedTools: TRIAGE_ALLOWED_TOOLS, disallowedTools: REVIEW_DISALLOWED_TOOLS, allowNonWriteUsers: true, displayReport: false },
  },
};
const PRIVILEGED_ACTIONS = [/^actions\/checkout@[0-9a-f]{40}$/, /^anthropics\/claude-code-action@[0-9a-f]{40}$/];
const HEAD_SHA_REF = '${{ github.event.pull_request.head.sha }}';
const BASE_SHA_REF = '${{ github.event.pull_request.base.sha }}';
const RESTORE_STEP = 'Restore agent configuration from the base commit';
// Commands that would execute files from the (PR-controlled) workspace. A backstop only: every run step is also
// pinned by digest, so no run step changes without a reviewed digest update.
const EXECUTES_CHECKOUT =
  /(^|[\s;&|(`!])(\.{1,2}\/\S*|\/(usr\/)?(local\/)?bin\/\S+|(ba|z|da|k)?sh\b|source\s|\.\s+\S|node\b|python3?\b|pip3?\b|perl\b|ruby\b|php\b|awk\s+-f|tsx\b|npm\b|pnpm\b|npx\b|yarn\b|make\b|uvx?\b|bunx?\b|deno\b|go\s+(run|build|test|generate)\b|cargo\b|forge\b|anvil\b|docker\b|eval\b|exec\b|env\s|xargs\b|chmod\s+\+x|git\s+-c\s)/m;
// Case-insensitive: GitHub expression functions are (ALWAYS() works), so the check must be too (ECC review M-case).
const UNCONDITIONAL = /\b(always|failure|cancelled)\s*\(/i;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Full-line shell comments only; anything after code on a line is still checked (fails closed).
const withoutComments = (run) => String(run).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const hasSecret = (node) =>
  strings(node).some((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => /\bsecrets\b/i.test(m[1])));
const onlyGithubToken = (node) =>
  strings(node).every((s) =>
    [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].every((m) => !/\bsecrets\b/i.test(m[1]) || /^\s*secrets\.GITHUB_TOKEN\s*$/.test(m[1])),
  );
export const runDigest = (run) => createHash('sha256').update(String(run)).digest('hex');
const ENV_REF = /^\$\{\{\s*env\.([A-Z0-9_]+)\s*\}\}$/;

let DIGESTS;
function digests() {
  DIGESTS ??= JSON.parse(readFileSync(new URL('./privileged-run-steps.json', import.meta.url), 'utf8'));
  return DIGESTS;
}

// Quoted --flag "value" from claude_args.
const argValue = (args, flag) => {
  const m = new RegExp(`--${flag}\\s+"([^"]*)"`).exec(args);
  return m ? m[1] : null;
};

function checkReviewStep(label, step, err, agent = { allowedTools: REVIEW_ALLOWED_TOOLS, disallowedTools: REVIEW_DISALLOWED_TOOLS, allowNonWriteUsers: false }) {
  const w = isObj(step.with) ? step.with : {};
  if (w.allowed_non_write_users !== undefined && !(agent.allowNonWriteUsers && String(w.allowed_non_write_users) === '*')) {
    err(`${label}: allowed_non_write_users is only allowed (as "*") for the issue-triage sandbox`);
  }
  if (agent.displayReport === false && w.display_report !== false) err(`${label}: display_report must be false (untrusted agent output)`);
  const args = norm(w.claude_args);
  const flags = [...args.matchAll(/--([a-zA-Z-]+)/g)].map((m) => m[1]).sort();
  if (JSON.stringify(flags) !== JSON.stringify(['allowedTools', 'disallowedTools', 'max-turns', 'model'])) {
    err(`${label}: claude_args may only set --model, --max-turns, --allowedTools and --disallowedTools (found ${flags.join(', ')})`);
  }
  if (argValue(args, 'allowedTools') !== agent.allowedTools) err(`${label}: --allowedTools must be exactly "${agent.allowedTools}"`);
  if (argValue(args, 'disallowedTools') !== agent.disallowedTools) err(`${label}: --disallowedTools must be exactly "${agent.disallowedTools}"`);
  const env = isObj(step.env) ? step.env : {};
  if (String(env.ECC_HOOKS_ENABLED) !== 'false') err(`${label}: env ECC_HOOKS_ENABLED must be "false"`);
  if (String(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) !== '1') err(`${label}: env CLAUDE_CODE_SUBPROCESS_ENV_SCRUB must be "1"`);
}

// Env keys that let a value hijack the interpreters a run step starts (security review L3 of add-issue-triage).
const HIJACK_ENV = /^(NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|PATH|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|GIT_.*)$/;
const hijackKeys = (env) => (isObj(env) ? Object.keys(env).filter((k) => HIJACK_ENV.test(k)) : []);

function checkPrivileged(file, name, wf, on) {
  const profile = PRIVILEGED[name];
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  for (const k of hijackKeys(wf.env)) err(`workflow env must not set ${k} in a privileged workflow`);
  for (const [jid, j] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(j)) continue;
    for (const k of hijackKeys(j.env)) err(`job '${jid}': env must not set ${k} in a privileged workflow`);
    for (const st of Array.isArray(j.steps) ? j.steps : []) {
      for (const k of hijackKeys(isObj(st) ? st.env : null)) err(`job '${jid}' step '${st.name ?? st.uses ?? '?'}': env must not set ${k} in a privileged workflow`);
    }
  }
  const pinned = digests()[name] ?? {};
  const seenSteps = new Set();
  const runText = [];

  for (const t of on) if (!profile.triggers.includes(t)) err(`trigger '${t}' is not allowed in ${name} (allowed: ${profile.triggers.join(', ')})`);
  if (!isObj(wf.permissions) || Object.keys(wf.permissions).length !== 0) {
    err(`top-level permissions must be {} in a privileged workflow, found ${JSON.stringify(wf.permissions ?? null)}`);
  }
  if (hasSecret(wf.env)) err('secrets must not be set in the workflow-level env of a privileged workflow');
  if (wf.defaults !== undefined) err('defaults are not allowed in a privileged workflow (custom shells/working directories)');
  const wfEnv = isObj(wf.env) ? wf.env : {};

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    const { conjuncts, topLevelOr } = splitCondition(job.if);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const required = profile.conditions[id];
    const commentOnly = conjuncts.includes("github.event_name == 'issue_comment'");

    if (topLevelOr) err(`job '${id}': no top-level || in a privileged job condition (every guard must hold)`);
    if (!required) err(`job '${id}' is not declared in the privileged profile for ${name}`);
    else for (const c of required) if (!conjuncts.includes(c)) err(`job '${id}' condition must include "${c}"`);
    if (job['continue-on-error'] !== undefined) err(`job '${id}': continue-on-error is not allowed in a privileged workflow`);
    if (job.defaults !== undefined) err(`job '${id}': defaults are not allowed in a privileged workflow`);

    // Write scopes: only the per-job allow-list.
    const allowed = profile.writeScopes[id] ?? [];
    for (const [scope, level] of Object.entries(isObj(job.permissions) ? job.permissions : {})) {
      if (level === 'write' && !allowed.includes(scope)) err(`job '${id}' requests ${scope}: write, which is not in its allow-list (${allowed.join(', ') || 'none'})`);
      else if (level !== 'write' && level !== 'read' && level !== 'none') err(`job '${id}' requests ${scope}: ${level}`);
    }

    if (commentOnly) {
      if (!conjuncts.includes(OWNER_ONLY)) err(`job '${id}' runs on comments and must be restricted to ${OWNER_ONLY}`);
      if (steps.some((s) => isObj(s) && s.uses)) err(`job '${id}' runs on comments and must not use actions (no checkout)`);
    } else if (profile.forkGuard !== false) {
      // pull_request_target: same-repo only, via the job condition or a fork-refusing FIRST step.
      const first = steps[0];
      const firstRefuses =
        isObj(first) && !first.uses && norm(first.if) === FORK &&
        String(first.run ?? '').split('\n').some((l) => l.trim() === 'exit 1');
      if (!conjuncts.includes(SAME_REPO) && !firstRefuses) {
        err(`job '${id}' must refuse fork PRs: job if containing "${SAME_REPO}", or a first step with if "${FORK}" whose run has a line "exit 1"`);
      }
    }

    if (profile.secretJobs && !profile.secretJobs.includes(id) && !onlyGithubToken(job)) {
      err(`job '${id}': secrets other than GITHUB_TOKEN may only be used in the ${profile.secretJobs.join(', ')} job`);
    }
    const hasCheckout = steps.some((s) => isObj(s) && /^actions\/checkout@/.test(String(s.uses ?? '')));
    if (hasSecret(job.env) && !(onlyGithubToken(job.env) && !hasCheckout)) {
      err(`job '${id}': secrets in job-level env are only allowed for GITHUB_TOKEN in jobs without a checkout; pass them per step`);
    }

    // Review workspace layout (harden-codeql-ci-findings, review L3): in a job that checks out this repository,
    // exactly one base-commit checkout, then exactly one PR-head checkout into headPath, both before the step that
    // restores agent configuration from the base commit.
    if (profile.headPath) {
      const isOwn = (s) => isObj(s) && /^actions\/checkout@/.test(String(s.uses ?? '')) && (!isObj(s.with) || s.with.repository === undefined);
      const own = steps.map((s, i) => [s, i]).filter(([s]) => isOwn(s));
      if (own.length > 0) {
        const bases = own.filter(([s]) => norm(s.with?.ref) === BASE_SHA_REF).map(([, i]) => i);
        const heads = own.filter(([s]) => norm(s.with?.ref) === HEAD_SHA_REF).map(([, i]) => i);
        const restore = steps.findIndex((s) => isObj(s) && s.name === RESTORE_STEP);
        if (bases.length !== 1 || heads.length !== 1 || own.length !== 2) {
          err(`job '${id}': exactly one base commit checkout and exactly one PR head checkout (path: ${profile.headPath}) are allowed`);
        } else if (bases[0] > heads[0]) {
          err(`job '${id}': the base commit checkout must come before the PR head checkout`);
        }
        if (restore < 0 || own.some(([, i]) => i > restore)) err(`job '${id}': every checkout must come before the restore step '${RESTORE_STEP}'`);
      }
    }

    for (const step of steps) {
      if (!isObj(step)) continue;
      const stepName = String(step.name ?? step.uses ?? '?');
      const label = `job '${id}' step '${stepName}'`;
      if (step['continue-on-error'] !== undefined) err(`${label}: continue-on-error is not allowed in a privileged workflow`);
      if (step.if !== undefined && UNCONDITIONAL.test(String(step.if))) err(`${label}: always()/failure()/cancelled() would run after a failed guard`);
      if (step.shell !== undefined) err(`${label}: custom shell is not allowed in a privileged workflow`);
      if (step.uses !== undefined) {
        const uses = String(step.uses);
        if (uses.startsWith('./') || uses.startsWith('.\\')) {
          err(`${label}: local action '${uses}' would run PR code`);
          continue;
        }
        if (!PRIVILEGED_ACTIONS.some((re) => re.test(uses))) err(`${label}: action '${uses}' is not allow-listed for privileged workflows`);
        if (/^actions\/checkout@/.test(uses)) {
          const w = isObj(step.with) ? step.with : {};
          if (!profile.headCheckout && !profile.defaultBranchCheckout) err(`${label}: ${name} must not check out code`);
          else if (w.repository === undefined && profile.defaultBranchCheckout) {
            if (w.ref !== undefined) err(`${label}: ${name} may only check out the default branch (no ref), never PR code`);
          } else if (w.repository === undefined) {
            const ref = norm(w.ref);
            if (profile.headPath && ref === BASE_SHA_REF) {
              if (w.path !== undefined) err(`${label}: the base commit checkout must be the workspace root (no path)`);
            } else if (ref !== HEAD_SHA_REF) {
              err(`${label}: the repository checkout must pin ref to the PR head SHA (${HEAD_SHA_REF})${profile.headPath ? ` or be the base commit (${BASE_SHA_REF})` : ''}`);
            } else if (profile.headPath && w.path !== profile.headPath) {
              err(`${label}: the PR head must be checked out with path: ${profile.headPath} (nothing in the workspace root may come from the PR)`);
            }
          } else {
            // External checkout (the ECC plugin): repository and ref must come from literal workflow-level env pins.
            const repoVar = ENV_REF.exec(norm(w.repository))?.[1];
            const refVar = ENV_REF.exec(norm(w.ref))?.[1];
            if (!repoVar || !/^[\w.-]+\/[\w.-]+$/.test(String(wfEnv[repoVar] ?? ''))) err(`${label}: external checkout repository must be a literal env pin (\${{ env.X }} = owner/name)`);
            if (!refVar || !/^[0-9a-f]{40}$/.test(String(wfEnv[refVar] ?? ''))) err(`${label}: external checkout ref must be a literal 40-hex env pin (${refVar ?? 'ref'} is ${JSON.stringify(wfEnv[refVar] ?? null)})`);
          }
          if (w['persist-credentials'] !== false) err(`${label}: checkout must set persist-credentials: false`);
        }
        if (/^anthropics\/claude-code-action@/.test(uses)) checkReviewStep(label, step, err, profile.agent);
      }
      if (step.run !== undefined) {
        const run = String(step.run);
        runText.push(run);
        const scan = profile.trustedScript ? withoutComments(run).replace(profile.trustedScript, ' ') : withoutComments(run);
        if (EXECUTES_CHECKOUT.test(scan)) err(`${label}: run step executes code from the checkout (privileged workflows may only read PR code)`);
        const key = `${id}/${stepName}`;
        seenSteps.add(key);
        if (pinned[key] !== runDigest(run)) {
          err(`${label}: run step digest ${runDigest(run)} does not match the reviewed digest in .github/scripts/privileged-run-steps.json (${pinned[key] ?? 'none'}); update it only with a security review (node .github/scripts/workflow-policy.mjs --digests)`);
        }
      }
    }
  }
  for (const key of Object.keys(pinned)) if (!seenSteps.has(key)) err(`privileged-run-steps.json pins '${key}', which no longer exists (remove stale digests)`);
  if (profile.authorGate) checkAuthorGate(profile.authorGate, wf, err);
  for (const line of profile.requiredRunLines) {
    if (!runText.some((r) => r.split('\n').some((l) => l.trim() === line))) err(`a run step must contain the line: ${line}`);
  }
  return errors;
}

// The trusted-author gate (gate-external-pr-automation D8): exact name, position, id, inputs; no condition; fails closed
// (ecc-review) or guards every later step (auto-merge).
function checkAuthorGate(gate, wf, err) {
  const job = isObj(wf.jobs) ? wf.jobs[gate.job] : undefined;
  const steps = isObj(job) && Array.isArray(job.steps) ? job.steps : [];
  const where = `job '${gate.job}': trusted-author gate '${gate.step}'`;
  const idx = steps.findIndex((s) => isObj(s) && s.name === gate.step);
  if (idx < 0) {
    err(`${where} is missing (ECC review and auto-merge run automatically only for trusted authors)`);
    return;
  }
  const step = steps[idx];
  if (idx !== gate.index) err(`${where} must be step ${gate.index + 1} (before any credential, checkout or model step), found step ${idx + 1}`);
  if (step.if !== undefined) err(`${where} must not have an if: (it must never be skipped)`);
  if (step.uses !== undefined || typeof step.run !== 'string') err(`${where} must be a run step`);
  if (step['working-directory'] !== undefined) err(`${where} must not set working-directory`);
  if (gate.id !== undefined && step.id !== gate.id) err(`${where} must have id: ${gate.id}`);
  const env = isObj(step.env) ? step.env : {};
  const got = Object.keys(env).sort();
  const want = Object.keys(gate.env).sort();
  if (JSON.stringify(got) !== JSON.stringify(want) || want.some((k) => norm(env[k]) !== gate.env[k])) {
    err(`${where}: env must be exactly ${JSON.stringify(gate.env)} (inputs only through env), found ${JSON.stringify(env)}`);
  }
  if (gate.failClosed && !String(step.run ?? '').split('\n').some((l) => l.trim() === 'exit 1')) {
    err(`${where} must fail closed: its run needs an "exit 1" line for untrusted authors`);
  }
  if (gate.guardLaterSteps) {
    for (const later of steps.slice(idx + 1)) {
      if (isObj(later) && norm(later.if) !== gate.guardLaterSteps) {
        err(`job '${gate.job}' step '${later.name ?? later.uses ?? '?'}' must have exactly if: ${gate.guardLaterSteps}`);
      }
    }
  }
}

// GitHub login: 1-39 alphanumerics or single hyphens, not starting or ending with a hyphen. No bots ("[bot]"), no
// wildcards. Case-insensitively unique; 1 to 20 entries (gate-external-pr-automation D1).
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export function checkTrustedAuthors(text) {
  const file = TRUSTED_AUTHORS_FILE;
  let list;
  try {
    list = JSON.parse(text);
  } catch (e) {
    return [`${file}: not valid JSON (${e.message})`];
  }
  if (!Array.isArray(list) || list.length < 1 || list.length > 20) return [`${file}: must be a JSON array of 1 to 20 GitHub logins`];
  const errors = [];
  const seen = new Set();
  for (const v of list) {
    if (typeof v !== 'string' || !LOGIN.test(v)) errors.push(`${file}: ${JSON.stringify(v)} is not a GitHub user login (no bots, no wildcards)`);
    else if (seen.has(v.toLowerCase())) errors.push(`${file}: duplicate login ${JSON.stringify(v)}`);
    else seen.add(v.toLowerCase());
  }
  return errors;
}

// Current digests of every privileged run step, for a reviewed update of privileged-run-steps.json.
export function currentDigests(dir) {
  const out = {};
  for (const name of [...Object.keys(PRIVILEGED), ...Object.keys(DEPLOY_PROFILES)]) {
    const path = join(dir, 'workflows', name);
    if (!existsSync(path)) continue;
    const wf = parse(readFileSync(path, 'utf8'));
    out[name] = {};
    for (const [id, job] of Object.entries(isObj(wf?.jobs) ? wf.jobs : {})) {
      // Deploy workflows: only the jobs that hold the Fly token are pinned (ECC review #7).
      if (Object.hasOwn(DEPLOY_PROFILES, name) && !strings(job).some((s) => /FLY_API_TOKEN/i.test(s))) continue;
      for (const step of Array.isArray(job?.steps) ? job.steps : []) {
        if (isObj(step) && step.run !== undefined) out[name][`${id}/${String(step.name ?? step.uses ?? '?')}`] = runDigest(step.run);
      }
    }
  }
  return out;
}

// Accepted zizmor ignores, each as file:line, at most once per file (a moved line or another file is reported again):
// dangerous-triggers on the privileged workflows' trigger lines (adopt-ecc-review-and-auto-merge D1); self-repository
// on each deploy workflow's reusable-CI call, because actionlint 1.7.12 rejects the `$/` syntax zizmor suggests
// (add-continuous-deploy D4, split-dev-and-release-deploys).
const ZIZMOR_IGNORES = {
  'dangerous-triggers': new RegExp(`^(${Object.keys(PRIVILEGED).map((f) => f.replace('.', '\\.')).join('|')}):\\d+$`),
  'self-repository': /^deploy(-dev)?\.yml:\d+$/,
};

function triggers(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isObj(on)) return Object.keys(on);
  return [];
}

function strings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out));
  else if (isObj(node)) Object.entries(node).forEach(([k, v]) => { out.push(k); strings(v, out); });
  return out;
}

export function checkWorkflow(file, text) {
  const errors = [];
  if (/zizmor:\s*ignore/.test(text)) errors.push(`${file}: inline "zizmor: ignore" comments are not allowed; fix the finding instead`);

  let wf;
  try {
    wf = parse(text);
  } catch (e) {
    return [...errors, `${file}: cannot parse YAML (${e.message.split('\n')[0]})`];
  }
  if (!isObj(wf)) return [...errors, `${file}: not a workflow mapping`];

  const on = triggers(wf.on ?? wf.true);
  for (const t of FORBIDDEN_TRIGGERS) {
    if (on.includes(t)) errors.push(`${file}: the ${t} trigger is forbidden (privileged context reachable from fork PRs: write token and secrets)`);
  }

  const name = basename(file);
  const privileged = Object.hasOwn(PRIVILEGED, name) && on.some((t) => PRIVILEGED_TRIGGERS.includes(t));
  if (!Object.hasOwn(PRIVILEGED, name)) {
    for (const t of PRIVILEGED_TRIGGERS) {
      if (on.includes(t)) {
        errors.push(`${file}: the ${t} trigger is only allowed in ${Object.keys(PRIVILEGED).join(' and ')} (it runs with secrets and a write token for any PR or comment)`);
      }
    }
  }
  if (privileged) {
    errors.push(...checkPrivileged(file, name, wf, on));
    // Generic rules that still apply: every job declares permissions and a timeout.
    for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
      if (!isObj(job)) continue;
      if (!isObj(job.permissions)) errors.push(`${file}: job '${id}' must declare its own permissions as a mapping (least privilege)`);
      if (job['timeout-minutes'] === undefined) errors.push(`${file}: job '${id}' must set timeout-minutes`);
    }
    // Deploy credentials stay in the deploy workflows (add-continuous-deploy D7), privileged workflows included.
    if (strings(wf).some((s) => /FLY_API_TOKEN/i.test(s))) errors.push(`${file}: FLY_API_TOKEN may only be referenced by the deploy workflows (${DEPLOY_FILES})`);
    for (const [id, j] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
      if (isObj(j) && j.environment !== undefined) errors.push(`${file}: job '${id}': privileged workflows may not use an environment (the deploy environments belong to the deploy workflows)`);
    }
    return errors;
  }

  const top = wf.permissions;
  const topOk = isObj(top) && (Object.keys(top).length === 0 || (Object.keys(top).length === 1 && top.contents === 'read'));
  if (!topOk) errors.push(`${file}: top-level permissions must be exactly "contents: read" (or {}), found ${JSON.stringify(top ?? null)}`);

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    if (job.permissions === undefined) errors.push(`${file}: job '${id}' must declare its own permissions (least privilege)`);
    else if (!isObj(job.permissions)) {
      errors.push(`${file}: job '${id}' uses ${JSON.stringify(job.permissions)}; list only the scopes it needs (read-only)`);
    } else {
      // Read-only allow-list (security review MEDIUM-5). A job that needs a write scope needs a spec change here.
      for (const [scope, level] of Object.entries(job.permissions)) {
        // No exceptions: the deploy workflows' `supersede` job (actions: write) is gone (split-dev-and-release-deploys D2).
        if (level !== 'read' && level !== 'none') errors.push(`${file}: job '${id}' requests ${scope}: ${level}; only read/none is allowed (no write scopes)`);
      }
    }
    if (job['timeout-minutes'] === undefined && job.uses === undefined) {
      errors.push(`${file}: job '${id}' must set timeout-minutes`);
    }
  }

  if (on.includes('pull_request') || [...FORBIDDEN_TRIGGERS, ...PRIVILEGED_TRIGGERS].some((t) => on.includes(t))) {
    // Any use of the secrets context inside an expression, whatever the case or form (secrets.X, secrets['X'],
    // toJSON(secrets), SECRETS.X), plus `secrets: inherit` (security review MEDIUM-3).
    const exprs = strings(wf).flatMap((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]));
    const hits = [...exprs.filter((e) => /\bsecrets\b/i.test(e)), ...strings(wf).filter((s) => s === 'inherit')];
    if (hits.length) errors.push(`${file}: secrets must not be referenced in a PR-triggered workflow (${hits.length} reference(s))`);
  }

  if (Object.hasOwn(SCHEDULED_READ_ONLY, name)) errors.push(...checkScheduled(file, name, wf, on));

  // Deployments (OpenSpec changes add-continuous-deploy D7, gate-production-deploys, split-dev-and-release-deploys D7).
  const mentionsToken = strings(wf).some((s) => /FLY_API_TOKEN/i.test(s));
  const jobsList = Object.entries(isObj(wf.jobs) ? wf.jobs : {}).filter(([, j]) => isObj(j));
  // Environment names are case-insensitive on GitHub and must never be computed (review M3).
  for (const [id, j] of jobsList) {
    if (j.environment !== undefined && /\$\{\{/.test(String(envName(j.environment)))) {
      errors.push(`${file}: job '${id}': environment must be a literal name, not an expression`);
    }
  }
  const usesDeployEnv = jobsList.some(([, j]) => ALL_DEPLOY_ENVIRONMENTS.includes(envName(j.environment)));
  if (Object.hasOwn(DEPLOY_PROFILES, name)) errors.push(...checkDeploy(file, name, wf, on));
  else {
    if (mentionsToken) errors.push(`${file}: FLY_API_TOKEN may only be referenced by the deploy workflows (${DEPLOY_FILES})`);
    if (usesDeployEnv) errors.push(`${file}: environments ${ALL_DEPLOY_ENVIRONMENTS.join(', ')} may only be used by the deploy workflows (${DEPLOY_FILES})`);
  }
  return errors;
}

// Read-only scheduled workflows (add-privacy-preserving-analytics task 2.2; spec product-metrics "Read-only scheduled
// run"). They are not PR-triggered, so the generic secrets rule would not reach them; this profile does.
export const SCHEDULED_READ_ONLY = {
  'metrics.yml': { artifact: { maxRetentionDays: 90 } },
  'beacon-drift.yml': {},
};
const SCHEDULED_TRIGGERS = ['schedule', 'workflow_dispatch'];
// Allow-lists rather than block-lists (security review LOW-4): the only actions, and the only programs a run step may
// start (shell grouping braces aside). No command substitution, no inline node code, no pnpm dlx/exec.
const SCHEDULED_ACTIONS = ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node', 'actions/upload-artifact'];
const SCHEDULED_PROGRAMS = ['pnpm', 'node', 'echo'];
// node: only a script file, no flags (no --eval/--import/-r in any form, no script from stdin).
const NODE_SCRIPT = /^[\w@][\w@./-]*\.(m?js|ts)$/;
// pnpm: only a locked install, or a named script of a filtered workspace package.
const PNPM_SCRIPTS = ['metrics', 'test', 'typecheck'];
function pnpmOk(args) {
  if (args[0] === 'install') return args.includes('--frozen-lockfile') && args.slice(1).every((a, i, all) => a === '--frozen-lockfile' || a === '--filter' || all[i - 1] === '--filter');
  return args[0] === '--filter' && /^@cryoshield\/[\w-]+$/.test(args[1] ?? '') && PNPM_SCRIPTS.includes(args[2] ?? '');
}
function scheduledRunProblems(run) {
  const text = withoutComments(run);
  const problems = [];
  if (/\$\(|`|<\(|>\(/.test(text)) problems.push('command substitution');
  if (/[<>]/.test(text)) problems.push('redirection');
  if (/GITHUB_(ENV|PATH|OUTPUT|STATE)/.test(text)) problems.push('writing GITHUB_ENV/GITHUB_PATH/GITHUB_OUTPUT');
  for (const raw of text.split(/\n|;|&&|\|\||\||&/)) {
    const words = raw.trim().split(/\s+/).filter((w) => w && !/^[{}()]$/.test(w));
    if (words.length === 0) continue;
    const [cmd, ...args] = words;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) problems.push(`environment assignment '${cmd}'`);
    else if (!SCHEDULED_PROGRAMS.includes(cmd)) problems.push(`program '${cmd}'`);
    else if (cmd === 'node' && !(args.length >= 1 && NODE_SCRIPT.test(args[0]))) problems.push(`'node ${args.join(' ')}' (only node <script file>)`);
    else if (cmd === 'pnpm' && !pnpmOk(args)) problems.push(`'pnpm ${args.join(' ')}' (only pnpm install --frozen-lockfile, or pnpm --filter @cryoshield/<pkg> ${PNPM_SCRIPTS.join('|')})`);
  }
  return problems;
}

// Belt and braces next to the allow-list: commits, pushes, tags, the gh CLI, GitHub API writes, HTTP write verbs, deploys.
const WRITES_SOMEWHERE = /\bgit\s+(push|commit|tag|remote)\b|(^|[\s;&|(])gh\s+\S|api\.github\.com|-X\s*(POST|PUT|PATCH|DELETE)\b|--request\s+(POST|PUT|PATCH|DELETE)\b|\bfly(ctl)?\s+deploy\b|\bflyctl\b/m;

function checkScheduled(file, name, wf, on) {
  const profile = SCHEDULED_READ_ONLY[name];
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  for (const t of on) if (!SCHEDULED_TRIGGERS.includes(t)) err(`trigger '${t}' is not allowed in ${name} (read-only scheduled workflows run only on ${SCHEDULED_TRIGGERS.join(' and ')})`);
  const dispatch = isObj(wf.on) ? wf.on.workflow_dispatch : undefined;
  if (isObj(dispatch) && dispatch.inputs !== undefined) err('workflow_dispatch may not take inputs (nothing user-controlled reaches a scheduled read-only run)');
  const secretRefs = exprsOf(wf).filter((e) => /\bsecrets\b/i.test(e)).length + strings(wf).filter((x) => x === 'inherit').length;
  if (secretRefs) err(`secrets must not be referenced in a read-only scheduled workflow, GITHUB_TOKEN included (${secretRefs} reference(s))`);
  if (exprsOf(wf).some((e) => /\bgithub\s*\.\s*token\b|\bgithub\s*\[\s*['"]token['"]\s*\]/i.test(e))) err('github.token must not be referenced in a read-only scheduled workflow');
  const uploads = [];
  // interpreter hijacks, plus package-manager config that reaches node (npm_config_node_options -> NODE_OPTIONS)
  const envKeys = (env) => [...hijackKeys(env), ...(isObj(env) ? Object.keys(env).filter((k) => /^(npm|pnpm)_config_|^NODE_EXTRA_CA_CERTS$/i.test(k)) : [])];
  for (const k of envKeys(wf.env)) err(`workflow env must not set ${k}`);
  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    for (const k of envKeys(job.env)) err(`job '${id}': env must not set ${k}`);
    for (const st of Array.isArray(job.steps) ? job.steps.filter(isObj) : []) for (const k of envKeys(st.env)) err(`job '${id}' step '${st.name ?? st.uses ?? '?'}': env must not set ${k}`);
    if (job.environment !== undefined) err(`job '${id}' may not use an environment`);
    if (job.uses !== undefined) err(`job '${id}' may not call a reusable workflow`);
    const perms = isObj(job.permissions) ? job.permissions : {};
    for (const [scope, level] of Object.entries(perms)) {
      if (!(scope === 'contents' && level === 'read')) err(`job '${id}' requests ${scope}: ${level}; a read-only scheduled job may hold only contents: read`);
    }
    for (const step of Array.isArray(job.steps) ? job.steps.filter(isObj) : []) {
      const label = `job '${id}' step '${step.name ?? step.uses ?? '?'}'`;
      const uses = String(step.uses ?? '');
      if (/^actions\/checkout@/.test(uses) && (!isObj(step.with) || step.with['persist-credentials'] !== false)) err(`${label}: checkout must set persist-credentials: false`);
      if (/^actions\/upload-artifact@/.test(uses)) uploads.push([label, step]);
      if (step.uses !== undefined && !SCHEDULED_ACTIONS.includes(uses.split('@')[0])) err(`${label}: action '${uses.split('@')[0]}' is not allowed in a read-only scheduled workflow (allowed: ${SCHEDULED_ACTIONS.join(', ')})`);
      if (step.shell !== undefined) err(`${label}: a custom shell is not allowed in a read-only scheduled workflow`);
      if (step.run !== undefined) {
        if (WRITES_SOMEWHERE.test(withoutComments(step.run))) err(`${label}: a read-only scheduled workflow must never commit, push, call the GitHub API or deploy`);
        for (const p of scheduledRunProblems(step.run)) err(`${label}: ${p} is not allowed in a read-only scheduled workflow (programs: ${SCHEDULED_PROGRAMS.join(', ')})`);
      }
    }
  }
  if (profile.artifact) {
    if (uploads.length === 0) err(`${name} must upload its report with actions/upload-artifact`);
    for (const [label, step] of uploads) {
      const days = Number(isObj(step.with) ? step.with['retention-days'] : NaN);
      if (!Number.isInteger(days) || days < 1 || days > profile.artifact.maxRetentionDays) err(`${label}: retention-days must be set, at most ${profile.artifact.maxRetentionDays}`);
    }
  }
  return errors;
}

// One profile per deploy workflow (split-dev-and-release-deploys D1/D7). Each file may name ONLY its own two environments,
// so each Fly token's environment is reachable from exactly one workflow's release job. Every value is literal.
const OWNER_GATE = 'github.triggering_actor == github.repository_owner';
// Production runs only AT a v* tag ref, for the release event and for a dispatch alike (ECC review HIGH: no main path).
const RELEASE_REF_GATE = "startsWith(github.ref, 'refs/tags/v')";
export const DEPLOY_PROFILES = {
  // Production: only an owner-published v* release, or the owner's dispatch AT a v* tag (redeploy/rollback).
  'deploy.yml': {
    triggers: ['release', 'workflow_dispatch'],
    releaseTypes: ['published'],
    // the tag is the run's own ref (github.ref_name); an input could name another tag than the code that runs
    dispatchInputs: false,
    // no workflow-level group: it is claimed before the owner gate, so anyone's skipped run could hold or replace it
    concurrency: null,
    firstJob: [OWNER_GATE, RELEASE_REF_GATE],
    releaseEnv: 'production',
    buildEnv: 'production-build',
    releaseGroup: 'deploy-production',
    // right before fly deploy: the tag still points at the built commit, which is still reachable from main
    recheck: { id: 'tag-check', run: /\.github\/scripts\/deploy\/release-ref\.sh/ },
    // the tag-check fails the job when the tag moved, so the deploy step needs no condition
    deployIf: undefined,
    forbidden: [],
  },
  // Development: every main commit (push for human merges, the schedule for auto-merges, dispatch), no approval.
  'deploy-dev.yml': {
    triggers: ['push', 'schedule', 'workflow_dispatch'],
    pushBranches: ['main'],
    concurrency: 'deploy-dev-${{ github.sha }}',
    firstJob: ["github.ref == 'refs/heads/main'"],
    releaseEnv: 'development',
    buildEnv: 'development-build',
    releaseGroup: 'deploy-development',
    recheck: { id: 'head-check', run: /commits\/main/ },
    // a superseded dev release ends green with a notice (ECC L1), so deploy and smoke run only for main's HEAD
    deployIf: "steps.head-check.outputs.current == 'true'",
    // no analytics on dev (ECC M2): the beacon token is never even passed to the dev build
    forbidden: [/VITE_CF_BEACON_TOKEN/i],
  },
};
const DEPLOY_FILES = Object.keys(DEPLOY_PROFILES).join(', ');
const ALL_DEPLOY_ENVIRONMENTS = Object.values(DEPLOY_PROFILES).flatMap((p) => [p.releaseEnv, p.buildEnv]);
const DEPLOY_TOKEN_STEPS = ['deploy', 'rollback'];
const envName = (e) => String(isObj(e) ? e.name ?? '' : e ?? '').trim().toLowerCase();
// The only secret expressions a deploy workflow may contain, each only in the step env of the named steps (review M3),
// and only in the job environment that holds it (per profile: the release env for the token, the build env otherwise).
const DEPLOY_SECRETS = { deploy: ['FLY_API_TOKEN'], rollback: ['FLY_API_TOKEN'], 'web-env': ['VITE_BUNDLER_URL'] };
const secretEnvironment = (profile, secret) => (secret === 'FLY_API_TOKEN' ? profile.releaseEnv : profile.buildEnv);
// deploy-skip-when-unconfigured: presence checks (`secrets.X != ''`, a boolean, never the value), per step id.
const DEPLOY_SECRET_PRESENCE = { config: ['VITE_BUNDLER_URL'] };
// Jobs holding the Fly token run no build tooling or third-party code (review H1).
const TOKEN_JOB_ACTIONS = [/^actions\/checkout@[0-9a-f]{40}$/, /^actions\/download-artifact@[0-9a-f]{40}$/];
const BUILD_TOOLING = /(^|[\s;&|(`!/])(node|npm|npx|pnpm|yarn|bunx?|deno|vite|tsx|python3?|pip3?|uvx?|make|docker)\b/m;
const exprsOf = (node) => strings(node).flatMap((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]));
const usesSecret = (node, re = /\bsecrets\b/i) => exprsOf(node).some((e) => re.test(e) && !/^\s*secrets\.GITHUB_TOKEN\s*$/i.test(e));

// Split a job condition into its top-level `&&` conjuncts (parentheses respected) and report any top-level `||`,
// so `a && (b || c)` is fine but `a || true` or `a && b || true` is not (ECC review #3).
export function splitCondition(cond) {
  const text = String(cond ?? '');
  const conjuncts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  let topLevelOr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && text.startsWith('&&', i)) {
      conjuncts.push(norm(text.slice(start, i)));
      start = i + 2;
      i++;
    } else if (depth === 0 && text.startsWith('||', i)) {
      topLevelOr = true;
    }
  }
  conjuncts.push(norm(text.slice(start)));
  return { conjuncts: conjuncts.filter(Boolean), topLevelOr };
}

function checkDeploy(file, name, wf, on) {
  const profile = DEPLOY_PROFILES[name];
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  const pinnedDeploy = digests()[name] ?? {};
  const seenPinned = new Set();
  const allowedEnvs = [profile.releaseEnv, profile.buildEnv];
  for (const t of on) if (!profile.triggers.includes(t)) err(`trigger '${t}' is not allowed (${name} runs only on ${profile.triggers.join(', ')}; never on pull requests)`);
  if (on.includes('push')) {
    const branches = isObj(wf.on) && isObj(wf.on.push) ? wf.on.push.branches : undefined;
    if (JSON.stringify(branches) !== JSON.stringify(profile.pushBranches ?? null)) err(`push must be limited to branches: [${(profile.pushBranches ?? []).join(', ')}]`);
  }
  if (on.includes('release')) {
    const types = isObj(wf.on) && isObj(wf.on.release) ? wf.on.release.types : undefined;
    if (JSON.stringify(types) !== JSON.stringify(profile.releaseTypes ?? null)) err(`release must be limited to types: [${(profile.releaseTypes ?? []).join(', ')}] (edited/created releases never deploy)`);
  }
  const c = wf.concurrency;
  if (profile.concurrency === null) {
    if (c !== undefined) err('no workflow-level concurrency: it is claimed before the owner gate (a non-owner run could hold or replace it); use the release job\'s group');
  } else if (!isObj(c) || norm(c.group) !== profile.concurrency || c['cancel-in-progress'] !== false) {
    err(`workflow concurrency must be { group: ${profile.concurrency}, cancel-in-progress: false } (never cancelled)`);
  }
  if (profile.dispatchInputs === false && on.includes('workflow_dispatch')) {
    const d = isObj(wf.on) ? wf.on.workflow_dispatch : undefined;
    if (isObj(d) && d.inputs !== undefined) err('workflow_dispatch may not take inputs: the release tag is the run\'s own ref (gh workflow run deploy.yml --ref vX.Y.Z)');
  }
  const releaseJobs = Object.entries(isObj(wf.jobs) ? wf.jobs : {}).filter(([, j]) => isObj(j) && envName(j.environment) === profile.releaseEnv);
  if (releaseJobs.length > 1) err(`only one job may use environment ${profile.releaseEnv} (one release job), found ${releaseJobs.map(([i]) => i).join(', ')}`);
  if (strings(wf).includes('inherit')) err('secrets: inherit is not allowed');
  if (strings(wf.env).some((s) => /FLY_API_TOKEN/i.test(s)) || usesSecret(wf.env)) err('no secrets (FLY_API_TOKEN or any other) in the workflow-level env');

  for (const re of profile.forbidden) if (strings(wf).some((x) => re.test(x))) err(`${re} must not appear in ${name} (ECC M2: no analytics on dev)`);

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    const needs = [].concat(job.needs ?? []);
    const { conjuncts, topLevelOr } = splitCondition(job.if);
    if (topLevelOr) err(`job '${id}': no top-level || / or in a deploy workflow job condition (ECC review #3; group alternatives in parentheses)`);
    // ECC M3: a status function in a JOB condition overrides the implicit success() of its needs, so a job would run
    // after a failed or skipped test/build (e.g. `always() && needs.detect.outputs.deploy == 'true'`). Step-level
    // failure()/cancelled() (rollback, fail loudly) stay allowed.
    if (UNCONDITIONAL.test(String(job.if ?? ''))) err(`job '${id}': always(), failure() and cancelled() are not allowed in a deploy job condition (ECC M3)`);
    if (needs.includes('config') && !conjuncts.includes("needs.config.outputs.configured == 'true'")) {
      err(`job '${id}' needs config, so its condition must include "needs.config.outputs.configured == 'true'" as a top-level conjunct (ECC M3)`);
    }
    if (needs.length > 0 && !conjuncts.includes("needs.detect.outputs.deploy == 'true'")) {
      err(`job '${id}' has needs, so its condition must include "needs.detect.outputs.deploy == 'true'" as a top-level conjunct (ECC review #4)`);
    }
    if (needs.length === 0) {
      for (const want of profile.firstJob) {
        if (!conjuncts.includes(want)) err(`job '${id}' has no needs, so its condition must include "${want}" as a top-level conjunct`);
      }
    }
    const envn = envName(job.environment);
    const isRelease = envn === profile.releaseEnv;
    // Without a workflow-level group, any other job group must be per run: a shared one would be claimed by a
    // non-owner's run (skipped a moment later) and could hold or replace the owner's (ECC review low).
    if (profile.concurrency === null && !isRelease && job.concurrency !== undefined) {
      const jc = job.concurrency;
      if (!isObj(jc) || !String(jc.group ?? '').includes('${{ github.run_id }}') || jc['cancel-in-progress'] !== false) {
        err(`job '${id}': only the release job may share a concurrency group; use a per-run group (... \${{ github.run_id }}, cancel-in-progress: false)`);
      }
    }
    if (job.environment !== undefined && !allowedEnvs.includes(envn)) err(`job '${id}': environment '${envn}' is not allowed here; ${name} may only use ${allowedEnvs.join(' and ')}`);
    if (usesSecret(job) && !allowedEnvs.includes(envn)) err(`job '${id}' uses secrets, so it must run in environment ${allowedEnvs.join(' or ')}`);
    const tokenJob = strings(job).some((s) => /FLY_API_TOKEN/i.test(s));
    if (tokenJob && !isRelease) err(`job '${id}' references FLY_API_TOKEN but is not in environment ${profile.releaseEnv} (the release job)`);
    if (isRelease && !tokenJob) err(`job '${id}' uses environment ${profile.releaseEnv} without the Fly token: ${profile.releaseEnv} is only for the release job`);
    if (isRelease) {
      const jc = job.concurrency;
      if (!isObj(jc) || jc.group !== profile.releaseGroup || jc['cancel-in-progress'] !== false) {
        err(`job '${id}' (${profile.releaseEnv}) must have concurrency { group: ${profile.releaseGroup}, cancel-in-progress: false } (one release at a time, never cut mid-deploy)`);
      }
      const steps = Array.isArray(job.steps) ? job.steps.filter(isObj) : [];
      const at = (sid) => steps.findIndex((s) => s.id === sid);
      const re = steps[at(profile.recheck.id)];
      if (!re || !profile.recheck.run.test(String(re.run ?? '')) || at(profile.recheck.id) !== at('deploy') - 1) {
        err(`job '${id}' must re-check its commit in a step with id ${profile.recheck.id} (running ${profile.recheck.run}) immediately before the step with id deploy (ECC L1)`);
      }
      if (re && re.if !== undefined) err(`job '${id}': the ${profile.recheck.id} step must run unconditionally`);
      const dep = steps[at('deploy')];
      if (dep && norm(dep.if) !== norm(profile.deployIf)) {
        err(`job '${id}': the deploy step's condition must be ${profile.deployIf === undefined ? 'absent' : `"${profile.deployIf}"`}`);
      }
    }
    if (strings(job.env).some((s) => /FLY_API_TOKEN/i.test(s)) || usesSecret(job.env)) err(`job '${id}': FLY_API_TOKEN or any secret must not be in a job-level env`);
    const steps = Array.isArray(job.steps) ? job.steps.filter(isObj) : [];
    for (const step of steps) {
      const label = `job '${id}' step '${step.name ?? step.id}'`;
      const { env, ...rest } = step;
      if (strings(rest).some((s) => /FLY_API_TOKEN/i.test(s))) err(`${label}: FLY_API_TOKEN may only be passed through the step env`);
      if (strings(env).some((s) => /FLY_API_TOKEN/i.test(s)) && !(isRelease && DEPLOY_TOKEN_STEPS.includes(step.id))) {
        err(`${label}: FLY_API_TOKEN is only allowed in steps with id ${DEPLOY_TOKEN_STEPS.join(' or ')} in the ${profile.releaseEnv} job`);
      }
      // Exact secret expressions only, in the step env of their step, in the environment that holds them.
      for (const e of exprsOf(rest)) if (/\bsecrets\b/i.test(e)) err(`${label}: secret expression \${{${e}}} is only allowed in a step env`);
      for (const e of exprsOf(env)) {
        if (!/\bsecrets\b/i.test(e)) continue;
        const presence = /^\s*secrets\.([A-Z_]+)\s*!=\s*''\s*$/.exec(e);
        if (presence && (DEPLOY_SECRET_PRESENCE[step.id] ?? []).includes(presence[1]) && envn === secretEnvironment(profile, presence[1])) continue;
        const m = /^\s*secrets\.([A-Z_]+)\s*$/.exec(e);
        if (!m || !(DEPLOY_SECRETS[step.id] ?? []).includes(m[1]) || envn !== secretEnvironment(profile, m[1])) {
          err(`${label}: secret expression \${{${e}}} is not allowed here (allowed: ${Object.entries(DEPLOY_SECRETS).map(([k, v]) => `${v.join(',')} in step '${k}'`).join('; ')})`);
        }
      }
      // H1: the token's job runs nothing but checkout/download-artifact and shell around flyctl, curl, jq and gh.
      if (tokenJob) {
        if (step.shell !== undefined) err(`job '${id}' holds FLY_API_TOKEN, so step '${step.name ?? step.id}' may not set a custom shell`);
        if (step.run !== undefined) {
          const key = `${id}/${String(step.name ?? step.uses ?? '?')}`;
          seenPinned.add(key);
          if (pinnedDeploy[key] !== runDigest(step.run)) {
            err(`job '${id}' holds FLY_API_TOKEN: step '${step.name ?? step.id}' run digest ${runDigest(step.run)} does not match the reviewed digest in .github/scripts/privileged-run-steps.json (${pinnedDeploy[key] ?? 'none'}); update it only with a security review (workflow-policy.mjs --digests)`);
          }
        }
        if (step.uses !== undefined && !TOKEN_JOB_ACTIONS.some((r) => r.test(String(step.uses)))) {
          err(`job '${id}' holds FLY_API_TOKEN, so step '${step.name ?? step.id}' may not use ${String(step.uses).split('@')[0]} (only actions/checkout and actions/download-artifact)`);
        }
        if (step.run !== undefined && BUILD_TOOLING.test(String(step.run))) {
          err(`job '${id}' holds FLY_API_TOKEN, so it may run no node, npm, pnpm or other build tooling (step '${step.name ?? step.id}'); build in a separate job`);
        }
      }
    }
  }
  for (const key of Object.keys(pinnedDeploy)) if (!seenPinned.has(key)) err(`privileged-run-steps.json pins ${name} '${key}', which no longer exists (remove stale digests)`);
  return errors;
}


// opts.selfRepositoryLines: { '<deploy file>': <line of its `uses: ./.github/workflows/ci.yml`> } for each deploy
// workflow that exists; when given, the self-repository ignores must be exactly those file:line entries (ECC review #8).
export function checkZizmorConfig(text, opts = {}) {
  const errors = [];
  let cfg;
  try {
    cfg = parse(text) ?? {};
  } catch (e) {
    return [`zizmor.yml: cannot parse YAML (${e.message.split('\n')[0]})`];
  }
  const rules = isObj(cfg.rules) ? cfg.rules : {};
  const policies = rules['unpinned-uses']?.config?.policies;
  if (!isObj(policies) || policies['*'] !== 'hash-pin') {
    errors.push('zizmor.yml: rules.unpinned-uses.config.policies must map "*" to hash-pin');
  } else if (Object.keys(policies).length !== 1) {
    errors.push('zizmor.yml: unpinned-uses policies may only contain "*": hash-pin (no per-owner relaxations)');
  }
  for (const [ruleName, rule] of Object.entries(rules)) {
    if (!isObj(rule)) continue;
    if (rule.disable) errors.push(`zizmor.yml: rule '${ruleName}' must not be disabled`);
    if (rule.ignore === undefined) continue;
    const allowed = ZIZMOR_IGNORES[ruleName];
    const entries = Array.isArray(rule.ignore) ? rule.ignore.map(String) : [];
    const files = entries.map((e) => e.split(':')[0]);
    if (!allowed || entries.length === 0 || !entries.every((e) => allowed.test(e)) || new Set(files).size !== files.length) {
      errors.push(`zizmor.yml: rule '${ruleName}' must not ignore findings (accepted, as <file>:<line> once per file: ${Object.entries(ZIZMOR_IGNORES).map(([r, re]) => `${r} ${re}`).join('; ')})`);
    }
    if (ruleName === 'self-repository' && opts.selfRepositoryLines !== undefined) {
      const want = Object.entries(opts.selfRepositoryLines).map(([f, l]) => `${f}:${l}`).sort();
      if (JSON.stringify([...entries].sort()) !== JSON.stringify(want)) {
        errors.push(`zizmor.yml: self-repository may only ignore ${want.join(' and ')} (each deploy workflow's reusable-CI call)`);
      }
    }
  }
  return errors;
}

export function checkGithubDir(dir) {
  const errors = [];
  const zizmor = join(dir, 'zizmor.yml');
  if (!existsSync(zizmor)) errors.push(`${zizmor}: missing (zizmor's hash-pin policy is part of this policy)`);
  else {
    const selfRepositoryLines = {};
    for (const f of Object.keys(DEPLOY_PROFILES)) {
      const p = join(dir, 'workflows', f);
      if (!existsSync(p)) continue;
      const idx = readFileSync(p, 'utf8').split('\n').findIndex((l) => /^\s*uses: \.\/\.github\/workflows\/ci\.yml\b/.test(l));
      if (idx >= 0) selfRepositoryLines[f] = idx + 1;
    }
    errors.push(...checkZizmorConfig(readFileSync(zizmor, 'utf8'), { selfRepositoryLines }));
  }

  const wfDir = join(dir, 'workflows');
  const files = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  for (const f of files) errors.push(...checkWorkflow(join('workflows', f), readFileSync(join(wfDir, f), 'utf8')));
  // The gated workflows read the trusted-author list at run time; it must exist and be valid.
  if (files.some((f) => PRIVILEGED[f]?.authorGate)) {
    const trusted = join(dir, TRUSTED_AUTHORS_FILE);
    if (!existsSync(trusted)) errors.push(`${trusted}: missing (the trusted-author gate of ecc-review.yml and auto-merge.yml reads it)`);
    else errors.push(...checkTrustedAuthors(readFileSync(trusted, 'utf8')));
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv[2] === '--digests') {
    // Print the current run-step digests of the privileged workflows (copy into privileged-run-steps.json only
    // after reviewing every changed run step).
    console.log(JSON.stringify(currentDigests(process.argv[3] ?? '.github'), null, 2));
    process.exit(0);
  }
  const dir = process.argv[2] ?? '.github';
  const errors = checkGithubDir(dir);
  if (errors.length) {
    for (const e of errors) console.error(`::error title=workflow policy::${e}`);
    process.exit(1);
  }
  console.log(`workflow policy: OK (${dir})`);
}
