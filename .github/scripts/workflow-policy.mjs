#!/usr/bin/env node
// Workflow security policy (OpenSpec change adopt-pr-workflow, decision 9; spec: ci-pipeline
// "CI supply-chain security"). Complements zizmor instead of duplicating it:
//   here:   no workflow_run; pull_request_target/issue_comment only in the PRIVILEGED files below, which must keep
//           their guards (fork refusal, owner-only comments, no PR code executed, head checkout read-only and only in
//           ecc-review, allow-listed actions and per-job write scopes); everywhere else top-level permissions exactly
//           `contents: read` (or {}), read-only job permissions, timeout-minutes, no secrets context in PR-triggered
//           workflows; no inline `zizmor: ignore`; zizmor.yml keeps hash-pin for "*" and ignores only
//           dangerous-triggers on the privileged files' trigger lines.
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
const PRIVILEGED_TRIGGERS = ['pull_request_target', 'issue_comment'];

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
const HOOKS_OFF_LINE = `printf '{"hooks":{}}\\n' > "$RUNNER_TEMP/ecc-plugin/hooks/hooks.json"`;

export const PRIVILEGED = {
  'ecc-review.yml': {
    triggers: ['pull_request_target', 'issue_comment'],
    writeScopes: { review: ['pull-requests'], rerun: ['actions'] },
    conditions: {
      review: ["github.event_name == 'pull_request_target'", NOT_DRAFT],
      rerun: ["github.event_name == 'issue_comment'", 'github.event.issue.pull_request', "startsWith(github.event.comment.body, '/ecc-review')", OWNER_ONLY],
    },
    headCheckout: true,
    requiredRunLines: [HOOKS_OFF_LINE],
  },
  'auto-merge.yml': {
    triggers: ['pull_request_target'],
    writeScopes: { 'auto-merge': ['contents', 'pull-requests'] },
    conditions: { 'auto-merge': [NOT_DRAFT, SAME_REPO, DEFAULT_BASE, NOT_DEPENDABOT] },
    headCheckout: false,
    requiredRunLines: [],
  },
};
const PRIVILEGED_ACTIONS = [/^actions\/checkout@[0-9a-f]{40}$/, /^anthropics\/claude-code-action@[0-9a-f]{40}$/];
const HEAD_SHA_REF = '${{ github.event.pull_request.head.sha }}';
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

function checkReviewStep(label, step, err) {
  const w = isObj(step.with) ? step.with : {};
  const args = norm(w.claude_args);
  const flags = [...args.matchAll(/--([a-zA-Z-]+)/g)].map((m) => m[1]).sort();
  if (JSON.stringify(flags) !== JSON.stringify(['allowedTools', 'disallowedTools', 'max-turns', 'model'])) {
    err(`${label}: claude_args may only set --model, --max-turns, --allowedTools and --disallowedTools (found ${flags.join(', ')})`);
  }
  if (argValue(args, 'allowedTools') !== REVIEW_ALLOWED_TOOLS) err(`${label}: --allowedTools must be exactly "${REVIEW_ALLOWED_TOOLS}"`);
  if (argValue(args, 'disallowedTools') !== REVIEW_DISALLOWED_TOOLS) err(`${label}: --disallowedTools must be exactly "${REVIEW_DISALLOWED_TOOLS}"`);
  const env = isObj(step.env) ? step.env : {};
  if (String(env.ECC_HOOKS_ENABLED) !== 'false') err(`${label}: env ECC_HOOKS_ENABLED must be "false"`);
  if (String(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) !== '1') err(`${label}: env CLAUDE_CODE_SUBPROCESS_ENV_SCRUB must be "1"`);
}

function checkPrivileged(file, name, wf, on) {
  const profile = PRIVILEGED[name];
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
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
    const rawIf = String(job.if ?? '');
    const conjuncts = rawIf.split('&&').map(norm).filter(Boolean);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const required = profile.conditions[id];
    const commentOnly = conjuncts.includes("github.event_name == 'issue_comment'");

    if (/\|\||\bor\b/.test(rawIf)) err(`job '${id}': no || in a privileged job condition (every guard must hold)`);
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
    } else {
      // pull_request_target: same-repo only, via the job condition or a fork-refusing FIRST step.
      const first = steps[0];
      const firstRefuses =
        isObj(first) && !first.uses && norm(first.if) === FORK &&
        String(first.run ?? '').split('\n').some((l) => l.trim() === 'exit 1');
      if (!conjuncts.includes(SAME_REPO) && !firstRefuses) {
        err(`job '${id}' must refuse fork PRs: job if containing "${SAME_REPO}", or a first step with if "${FORK}" whose run has a line "exit 1"`);
      }
    }

    const hasCheckout = steps.some((s) => isObj(s) && /^actions\/checkout@/.test(String(s.uses ?? '')));
    if (hasSecret(job.env) && !(onlyGithubToken(job.env) && !hasCheckout)) {
      err(`job '${id}': secrets in job-level env are only allowed for GITHUB_TOKEN in jobs without a checkout; pass them per step`);
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
          if (!profile.headCheckout) err(`${label}: ${name} must not check out code`);
          else if (w.repository === undefined) {
            if (norm(w.ref) !== HEAD_SHA_REF) err(`${label}: the repository checkout must pin ref to the PR head SHA (${HEAD_SHA_REF})`);
          } else {
            // External checkout (the ECC plugin): repository and ref must come from literal workflow-level env pins.
            const repoVar = ENV_REF.exec(norm(w.repository))?.[1];
            const refVar = ENV_REF.exec(norm(w.ref))?.[1];
            if (!repoVar || !/^[\w.-]+\/[\w.-]+$/.test(String(wfEnv[repoVar] ?? ''))) err(`${label}: external checkout repository must be a literal env pin (\${{ env.X }} = owner/name)`);
            if (!refVar || !/^[0-9a-f]{40}$/.test(String(wfEnv[refVar] ?? ''))) err(`${label}: external checkout ref must be a literal 40-hex env pin (${refVar ?? 'ref'} is ${JSON.stringify(wfEnv[refVar] ?? null)})`);
          }
          if (w['persist-credentials'] !== false) err(`${label}: checkout must set persist-credentials: false`);
        }
        if (/^anthropics\/claude-code-action@/.test(uses)) checkReviewStep(label, step, err);
      }
      if (step.run !== undefined) {
        const run = String(step.run);
        runText.push(run);
        if (EXECUTES_CHECKOUT.test(withoutComments(run))) err(`${label}: run step executes code from the checkout (privileged workflows may only read PR code)`);
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
  for (const name of Object.keys(PRIVILEGED)) {
    const path = join(dir, 'workflows', name);
    if (!existsSync(path)) continue;
    const wf = parse(readFileSync(path, 'utf8'));
    out[name] = {};
    for (const [id, job] of Object.entries(isObj(wf?.jobs) ? wf.jobs : {})) {
      for (const step of Array.isArray(job?.steps) ? job.steps : []) {
        if (isObj(step) && step.run !== undefined) out[name][`${id}/${String(step.name ?? step.uses ?? '?')}`] = runDigest(step.run);
      }
    }
  }
  return out;
}

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
  return errors;
}

export function checkZizmorConfig(text) {
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
    // The single accepted exception: dangerous-triggers on the trigger line of the privileged workflows,
    // pinned to file:line so a moved trigger or any other file is reported again.
    const entries = Array.isArray(rule.ignore) ? rule.ignore.map(String) : [];
    const narrow = new RegExp(`^(${Object.keys(PRIVILEGED).map((f) => f.replace('.', '\\.')).join('|')}):\\d+$`);
    const files = entries.map((e) => e.split(':')[0]);
    if (name !== 'dangerous-triggers' || entries.length === 0 || !entries.every((e) => narrow.test(e)) || new Set(files).size !== files.length) {
      errors.push(`zizmor.yml: rule '${name}' must not ignore findings (only dangerous-triggers may, as <privileged workflow>:<line>, once per file)`);
    }
  }
  return errors;
}

export function checkGithubDir(dir) {
  const errors = [];
  const zizmor = join(dir, 'zizmor.yml');
  if (!existsSync(zizmor)) errors.push(`${zizmor}: missing (zizmor's hash-pin policy is part of this policy)`);
  else errors.push(...checkZizmorConfig(readFileSync(zizmor, 'utf8')));

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
