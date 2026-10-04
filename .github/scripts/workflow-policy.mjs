#!/usr/bin/env node
// Workflow security policy (OpenSpec change adopt-pr-workflow, decision 9; spec: ci-pipeline
// "CI supply-chain security"). Complements zizmor instead of duplicating it:
//   here:   no workflow_run; pull_request_target/issue_comment/issues only in the PRIVILEGED files below, which must keep
//           their guards (fork refusal, owner-only comments, no PR code executed, head checkout read-only and only in
//           ecc-review, allow-listed actions and per-job write scopes); everywhere else top-level permissions exactly
//           `contents: read` (or {}), read-only job permissions, timeout-minutes, no secrets context in PR-triggered
//           workflows; no inline `zizmor: ignore`; zizmor.yml keeps hash-pin for "*" and ignores only
//           dangerous-triggers on the privileged files' trigger lines and self-repository on deploy.yml.
//   deploy: (add-continuous-deploy D7) deploy.yml only on push(main)/schedule/workflow_dispatch, first job gated on
//           refs/heads/main, concurrency deploy-production never cancelled, secrets only in environment production
//           jobs, FLY_API_TOKEN only in the step env of steps `deploy`/`rollback`; no other workflow may use
//           FLY_API_TOKEN or environment production. zizmor ignores: only self-repository on deploy.yml:<line>.
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
  },
  'auto-merge.yml': {
    triggers: ['pull_request_target'],
    writeScopes: { 'auto-merge': ['contents', 'pull-requests'] },
    conditions: { 'auto-merge': [NOT_DRAFT, SAME_REPO, DEFAULT_BASE, NOT_DEPENDABOT] },
    headCheckout: false,
    requiredRunLines: [],
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
const UNCONDITIONAL = /\b(always|failure|cancelled)\s*\(/;
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
  for (const line of profile.requiredRunLines) {
    if (!runText.some((r) => r.split('\n').some((l) => l.trim() === line))) err(`a run step must contain the line: ${line}`);
  }
  return errors;
}

// Current digests of every privileged run step, for a reviewed update of privileged-run-steps.json.
export function currentDigests(dir) {
  const out = {};
  for (const name of [...Object.keys(PRIVILEGED), 'deploy.yml']) {
    const path = join(dir, 'workflows', name);
    if (!existsSync(path)) continue;
    const wf = parse(readFileSync(path, 'utf8'));
    out[name] = {};
    for (const [id, job] of Object.entries(isObj(wf?.jobs) ? wf.jobs : {})) {
      // deploy.yml: only the jobs that hold the Fly token are pinned (ECC review #7).
      if (name === 'deploy.yml' && !strings(job).some((s) => /FLY_API_TOKEN/i.test(s))) continue;
      for (const step of Array.isArray(job?.steps) ? job.steps : []) {
        if (isObj(step) && step.run !== undefined) out[name][`${id}/${String(step.name ?? step.uses ?? '?')}`] = runDigest(step.run);
      }
    }
  }
  return out;
}

// Accepted zizmor ignores, each as file:line, at most once per file (a moved line or another file is reported again):
// dangerous-triggers on the privileged workflows' trigger lines (adopt-ecc-review-and-auto-merge D1); self-repository
// on deploy.yml's reusable-CI call, because actionlint 1.7.12 rejects the `$/` syntax zizmor suggests
// (add-continuous-deploy D4).
const ZIZMOR_IGNORES = {
  'dangerous-triggers': new RegExp(`^(${Object.keys(PRIVILEGED).map((f) => f.replace('.', '\\.')).join('|')}):\\d+$`),
  'self-repository': /^deploy\.yml:\d+$/,
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
    // Deploy credentials stay in deploy.yml (add-continuous-deploy D7), privileged workflows included.
    if (strings(wf).some((s) => /FLY_API_TOKEN/i.test(s))) errors.push(`${file}: FLY_API_TOKEN may only be referenced by deploy.yml`);
    for (const [id, j] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
      if (isObj(j) && j.environment !== undefined) errors.push(`${file}: job '${id}': privileged workflows may not use an environment (production belongs to deploy.yml)`);
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
        // Single exception (gate-production-deploys D4): deploy.yml's `supersede` cancels older waiting runs.
        const supersedeException = basename(file) === DEPLOY_WORKFLOW && id === 'supersede' && scope === 'actions' && level === 'write';
        if (level !== 'read' && level !== 'none' && !supersedeException) errors.push(`${file}: job '${id}' requests ${scope}: ${level}; only read/none is allowed (no write scopes)`);
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

  // Production deployment (OpenSpec change add-continuous-deploy, design D7).
  const mentionsToken = strings(wf).some((s) => /FLY_API_TOKEN/i.test(s));
  const jobsList = Object.entries(isObj(wf.jobs) ? wf.jobs : {}).filter(([, j]) => isObj(j));
  // Environment names are case-insensitive on GitHub and must never be computed (review M3).
  for (const [id, j] of jobsList) {
    if (j.environment !== undefined && /\$\{\{/.test(String(envName(j.environment)))) {
      errors.push(`${file}: job '${id}': environment must be a literal name, not an expression`);
    }
  }
  const usesProduction = jobsList.some(([, j]) => DEPLOY_ENVIRONMENTS.includes(envName(j.environment)));
  if (name === DEPLOY_WORKFLOW) errors.push(...checkDeploy(file, wf, on));
  else {
    if (mentionsToken) errors.push(`${file}: FLY_API_TOKEN may only be referenced by ${DEPLOY_WORKFLOW} (only deploy.yml deploys)`);
    if (usesProduction) errors.push(`${file}: environments production and production-build may only be used by ${DEPLOY_WORKFLOW} (only deploy.yml deploys)`);
  }
  return errors;
}

const DEPLOY_WORKFLOW = 'deploy.yml';
const DEPLOY_TRIGGERS = ['push', 'schedule', 'workflow_dispatch'];
const DEPLOY_TOKEN_STEPS = ['deploy', 'rollback'];
const envName = (e) => String(isObj(e) ? e.name ?? '' : e ?? '').trim().toLowerCase();
// The only secret expressions deploy.yml may contain, each only in the step env of the named steps (review M3).
const DEPLOY_SECRETS = { deploy: ['FLY_API_TOKEN'], rollback: ['FLY_API_TOKEN'], 'web-env': ['VITE_BUNDLER_URL'] };
// gate-production-deploys: the approved release job is the only `production` job; build config is in production-build.
const DEPLOY_ENVIRONMENTS = ['production', 'production-build'];
const SECRET_ENVIRONMENT = { FLY_API_TOKEN: 'production', VITE_BUNDLER_URL: 'production-build' };
// Jobs holding the Fly token run no build tooling or third-party code (review H1).
const TOKEN_JOB_ACTIONS = [/^actions\/checkout@[0-9a-f]{40}$/, /^actions\/download-artifact@[0-9a-f]{40}$/];
const BUILD_TOOLING = /(^|[\s;&|(`!/])(node|npm|npx|pnpm|yarn|bunx?|deno|vite|tsx|python3?|pip3?|uvx?|make|docker)\b/m;
const exprsOf = (node) => strings(node).flatMap((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]));
const usesSecret = (node, re = /\bsecrets\b/i) => exprsOf(node).some((e) => re.test(e) && !/^\s*secrets\.GITHUB_TOKEN\s*$/i.test(e));

// Split a job condition into its top-level `&&` conjuncts (parentheses respected) and report any top-level `||`/`or`,
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
    } else if (depth === 0 && (text.startsWith('||', i) || /^\bor\b/.test(text.slice(i)) && /\W/.test(text[i - 1] ?? ' '))) {
      topLevelOr = true;
    }
  }
  conjuncts.push(norm(text.slice(start)));
  return { conjuncts: conjuncts.filter(Boolean), topLevelOr };
}

function checkDeploy(file, wf, on) {
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  const pinnedDeploy = digests()['deploy.yml'] ?? {};
  const seenPinned = new Set();
  for (const t of on) if (!DEPLOY_TRIGGERS.includes(t)) err(`trigger '${t}' is not allowed (deploy.yml runs only on ${DEPLOY_TRIGGERS.join(', ')}; never on pull requests)`);
  const branches = isObj(wf.on) && isObj(wf.on.push) ? wf.on.push.branches : undefined;
  if (on.includes('push') && JSON.stringify(branches) !== JSON.stringify(['main'])) err('push must be limited to branches: [main]');
  // Per-commit workflow concurrency: the schedule never stacks runs for one commit while it waits for approval.
  const c = wf.concurrency;
  if (!isObj(c) || norm(c.group) !== 'deploy-${{ github.sha }}' || c['cancel-in-progress'] !== false) {
    err('workflow concurrency must be { group: deploy-${{ github.sha }}, cancel-in-progress: false } (per commit, never cancelled)');
  }
  const prodJobs = Object.entries(isObj(wf.jobs) ? wf.jobs : {}).filter(([, j]) => isObj(j) && envName(j.environment) === 'production');
  if (prodJobs.length > 1) err(`only one job may use environment production (one approval per release), found ${prodJobs.map(([i]) => i).join(', ')}`);
  if (strings(wf).includes('inherit')) err('secrets: inherit is not allowed');
  if (strings(wf.env).some((s) => /FLY_API_TOKEN/i.test(s)) || usesSecret(wf.env)) err('no secrets (FLY_API_TOKEN or any other) in the workflow-level env');

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    const needs = [].concat(job.needs ?? []);
    const { conjuncts, topLevelOr } = splitCondition(job.if);
    if (topLevelOr) err(`job '${id}': no top-level || / or in a deploy.yml job condition (ECC review #3; group alternatives in parentheses)`);
    if (needs.length > 0 && !conjuncts.includes("needs.detect.outputs.deploy == 'true'")) {
      err(`job '${id}' has needs, so its condition must include "needs.detect.outputs.deploy == 'true'" as a top-level conjunct (ECC review #4)`);
    }
    if (needs.length === 0 && !conjuncts.includes("github.ref == 'refs/heads/main'")) {
      err(`job '${id}' has no needs, so its condition must include "github.ref == 'refs/heads/main'"`);
    }
    const envn = envName(job.environment);
    const prod = envn === 'production';
    if (job.environment !== undefined && !DEPLOY_ENVIRONMENTS.includes(envn)) err(`job '${id}': the only allowed environments are ${DEPLOY_ENVIRONMENTS.join(' and ')}`);
    if (usesSecret(job) && !DEPLOY_ENVIRONMENTS.includes(envn)) err(`job '${id}' uses secrets, so it must run in environment production or production-build`);
    const tokenJob = strings(job).some((s) => /FLY_API_TOKEN/i.test(s));
    if (tokenJob && !prod) err(`job '${id}' references FLY_API_TOKEN but is not in environment production (the approved release job)`);
    if (prod && !tokenJob) err(`job '${id}' uses environment production without the Fly token: production is only for the approved release job`);
    if (prod) {
      const jc = job.concurrency;
      if (!isObj(jc) || jc.group !== 'deploy-production' || jc['cancel-in-progress'] !== false) {
        err(`job '${id}' (production) must have concurrency { group: deploy-production, cancel-in-progress: false } (one release at a time, never cut mid-deploy)`);
      }
    }
    if (strings(job.env).some((s) => /FLY_API_TOKEN/i.test(s)) || usesSecret(job.env)) err(`job '${id}': FLY_API_TOKEN or any secret must not be in a job-level env`);
    const steps = Array.isArray(job.steps) ? job.steps.filter(isObj) : [];
    const holdsToken = strings(job).some((s) => /FLY_API_TOKEN/i.test(s));
    for (const step of steps) {
      const label = `job '${id}' step '${step.name ?? step.id}'`;
      const { env, ...rest } = step;
      if (strings(rest).some((s) => /FLY_API_TOKEN/i.test(s))) err(`${label}: FLY_API_TOKEN may only be passed through the step env`);
      if (strings(env).some((s) => /FLY_API_TOKEN/i.test(s)) && !(prod && DEPLOY_TOKEN_STEPS.includes(step.id))) {
        err(`${label}: FLY_API_TOKEN is only allowed in steps with id ${DEPLOY_TOKEN_STEPS.join(' or ')} in a production job`);
      }
      // Exact secret expressions only, in the step env of their step.
      for (const e of exprsOf(rest)) if (/\bsecrets\b/i.test(e)) err(`${label}: secret expression \${{${e}}} is only allowed in a step env`);
      for (const e of exprsOf(env)) {
        if (!/\bsecrets\b/i.test(e)) continue;
        const m = /^\s*secrets\.([A-Z_]+)\s*$/.exec(e);
        if (!m || !(DEPLOY_SECRETS[step.id] ?? []).includes(m[1]) || envn !== SECRET_ENVIRONMENT[m[1]]) {
          err(`${label}: secret expression \${{${e}}} is not allowed here (allowed: ${Object.entries(DEPLOY_SECRETS).map(([k, v]) => `${v.join(',')} in step '${k}'`).join('; ')})`);
        }
      }
      // H1: the token's job runs nothing but checkout/download-artifact and shell around flyctl.
      if (holdsToken) {
        if (step.shell !== undefined) err(`job '${id}' holds FLY_API_TOKEN, so step '${step.name ?? step.id}' may not set a custom shell`);
        if (step.run !== undefined) {
          const key = `${id}/${String(step.name ?? step.uses ?? '?')}`;
          seenPinned.add(key);
          if (pinnedDeploy[key] !== runDigest(step.run)) {
            err(`job '${id}' holds FLY_API_TOKEN: step '${step.name ?? step.id}' run digest ${runDigest(step.run)} does not match the reviewed digest in .github/scripts/privileged-run-steps.json (${pinnedDeploy[key] ?? 'none'}); update it only with a security review (workflow-policy.mjs --digests)`);
          }
        }
        if (step.uses !== undefined && !TOKEN_JOB_ACTIONS.some((re) => re.test(String(step.uses)))) {
          err(`job '${id}' holds FLY_API_TOKEN, so step '${step.name ?? step.id}' may not use ${String(step.uses).split('@')[0]} (only actions/checkout and actions/download-artifact)`);
        }
        if (step.run !== undefined && BUILD_TOOLING.test(String(step.run))) {
          err(`job '${id}' holds FLY_API_TOKEN, so it may run no node, npm, pnpm or other build tooling (step '${step.name ?? step.id}'); build in a separate job`);
        }
      }
    }
  }
  for (const key of Object.keys(pinnedDeploy)) if (!seenPinned.has(key)) err(`privileged-run-steps.json pins deploy.yml '${key}', which no longer exists (remove stale digests)`);
  return errors;
}


// opts.selfRepositoryLine: the line of deploy.yml's `uses: ./.github/workflows/ci.yml`; when given, the
// self-repository ignore must be exactly that line (ECC review #8).
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
  for (const [name, rule] of Object.entries(rules)) {
    if (!isObj(rule)) continue;
    if (rule.disable) errors.push(`zizmor.yml: rule '${name}' must not be disabled`);
    if (rule.ignore === undefined) continue;
    const allowed = ZIZMOR_IGNORES[name];
    const entries = Array.isArray(rule.ignore) ? rule.ignore.map(String) : [];
    const files = entries.map((e) => e.split(':')[0]);
    if (!allowed || entries.length === 0 || !entries.every((e) => allowed.test(e)) || new Set(files).size !== files.length) {
      errors.push(`zizmor.yml: rule '${name}' must not ignore findings (accepted, as <file>:<line> once per file: ${Object.entries(ZIZMOR_IGNORES).map(([r, re]) => `${r} ${re}`).join('; ')})`);
    }
    if (name === 'self-repository' && opts.selfRepositoryLine !== undefined) {
      const want = `deploy.yml:${opts.selfRepositoryLine}`;
      if (JSON.stringify(entries) !== JSON.stringify([want])) errors.push(`zizmor.yml: self-repository may only ignore ${want} (deploy.yml's reusable-CI call)`);
    }
  }
  return errors;
}

export function checkGithubDir(dir) {
  const errors = [];
  const zizmor = join(dir, 'zizmor.yml');
  if (!existsSync(zizmor)) errors.push(`${zizmor}: missing (zizmor's hash-pin policy is part of this policy)`);
  else {
    const deployPath = join(dir, 'workflows', 'deploy.yml');
    const idx = existsSync(deployPath)
      ? readFileSync(deployPath, 'utf8').split('\n').findIndex((l) => /^\s*uses: \.\/\.github\/workflows\/ci\.yml\b/.test(l))
      : -1;
    errors.push(...checkZizmorConfig(readFileSync(zizmor, 'utf8'), idx >= 0 ? { selfRepositoryLine: idx + 1 } : {}));
  }

  const wfDir = join(dir, 'workflows');
  const files = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  for (const f of files) errors.push(...checkWorkflow(join('workflows', f), readFileSync(join(wfDir, f), 'utf8')));
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
