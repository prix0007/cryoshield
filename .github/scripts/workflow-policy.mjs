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
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const FORBIDDEN_TRIGGERS = ['workflow_run'];
// Triggers that run with secrets and a write-capable token on PR/comment events, whoever authored them.
const PRIVILEGED_TRIGGERS = ['pull_request_target', 'issue_comment'];

// The only workflows allowed to use privileged triggers (OpenSpec change adopt-ecc-review-and-auto-merge,
// design decision 3), each with its allowed triggers, per-job write scopes and whether it may check out the
// PR head (read only). Everything else about them is checked by checkPrivileged().
export const PRIVILEGED = {
  'ecc-review.yml': {
    triggers: ['pull_request_target', 'issue_comment'],
    writeScopes: { review: ['pull-requests'], rerun: ['actions'] },
    headCheckout: true,
  },
  'auto-merge.yml': {
    triggers: ['pull_request_target'],
    writeScopes: { 'auto-merge': ['contents', 'pull-requests'] },
    headCheckout: false,
  },
};
const PRIVILEGED_ACTIONS = [/^actions\/checkout@[0-9a-f]{40}$/, /^anthropics\/claude-code-action@[0-9a-f]{40}$/];
const HEAD_SHA_REF = '${{ github.event.pull_request.head.sha }}';
const SAME_REPO = 'github.event.pull_request.head.repo.full_name == github.repository';
const FORK = 'github.event.pull_request.head.repo.full_name != github.repository';
const OWNER_ONLY = "github.event.comment.author_association == 'OWNER'";
// Commands that would execute files from the (PR-controlled) workspace. Deliberately broad: privileged
// workflows only move files, call git/gh/jq, and install OS packages.
const EXECUTES_CHECKOUT =
  /(^|[\s;&|(`!])(\.{1,2}\/\S*|(ba|z|da)?sh\s+(?!-)\S|source\s|\.\s+\S|node\b|python3?\b|pip3?\b|npm\b|pnpm\b|npx\b|yarn\b|make\b|uvx?\b|bun\b|deno\b|go\s+(run|build|test|generate)\b|cargo\b|forge\b|anvil\b|docker\b|eval\b|exec\b|chmod\s+\+x)/m;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Full-line shell comments only; anything after code on a line is still checked (fails closed).
const withoutComments = (run) => String(run).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const hasSecret = (node) =>
  strings(node).some((s) => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => /\bsecrets\b/i.test(m[1])));
const onlyGithubToken = (node) =>
  strings(node).every((s) =>
    [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].every((m) => !/\bsecrets\b/i.test(m[1]) || /^\s*secrets\.GITHUB_TOKEN\s*$/.test(m[1])),
  );

function checkPrivileged(file, name, wf, on) {
  const profile = PRIVILEGED[name];
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);

  for (const t of on) if (!profile.triggers.includes(t)) err(`trigger '${t}' is not allowed in ${name} (allowed: ${profile.triggers.join(', ')})`);
  if (!isObj(wf.permissions) || Object.keys(wf.permissions).length !== 0) {
    err(`top-level permissions must be {} in a privileged workflow, found ${JSON.stringify(wf.permissions ?? null)}`);
  }
  if (hasSecret(wf.env)) err('secrets must not be set in the workflow-level env of a privileged workflow');

  for (const [id, job] of Object.entries(isObj(wf.jobs) ? wf.jobs : {})) {
    if (!isObj(job)) continue;
    const jobIf = norm(job.if);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const commentOnly = jobIf.includes("github.event_name == 'issue_comment'");

    // Write scopes: only the per-job allow-list.
    const allowed = profile.writeScopes[id] ?? [];
    for (const [scope, level] of Object.entries(isObj(job.permissions) ? job.permissions : {})) {
      if (level === 'write' && !allowed.includes(scope)) err(`job '${id}' requests ${scope}: write, which is not in its allow-list (${allowed.join(', ') || 'none'})`);
      else if (level !== 'write' && level !== 'read' && level !== 'none') err(`job '${id}' requests ${scope}: ${level}`);
    }

    if (commentOnly) {
      // Comment-triggered: owner only, no actions, no checkout.
      if (!jobIf.includes(OWNER_ONLY)) err(`job '${id}' runs on comments and must be restricted to ${OWNER_ONLY}`);
      if (steps.some((s) => isObj(s) && s.uses)) err(`job '${id}' runs on comments and must not use actions (no checkout)`);
    } else {
      // pull_request_target: same-repo only, via the job condition or a fork-refusing FIRST step.
      const first = steps[0];
      const firstRefuses =
        isObj(first) && !first.uses && norm(first.if) === FORK && /\bexit 1\b/.test(String(first.run ?? ''));
      if (!jobIf.includes(SAME_REPO) && !firstRefuses) {
        err(`job '${id}' must refuse fork PRs: job if containing "${SAME_REPO}", or a first step with if "${FORK}" that exits 1`);
      }
    }

    const hasCheckout = steps.some((s) => isObj(s) && /^actions\/checkout@/.test(String(s.uses ?? '')));
    if (hasSecret(job.env) && !(onlyGithubToken(job.env) && !hasCheckout)) {
      err(`job '${id}': secrets in job-level env are only allowed for GITHUB_TOKEN in jobs without a checkout; pass them per step`);
    }

    for (const step of steps) {
      if (!isObj(step)) continue;
      const label = `job '${id}' step '${step.name ?? step.uses ?? '?'}'`;
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
          else if (w.repository === undefined && norm(w.ref) !== HEAD_SHA_REF) err(`${label}: the repository checkout must pin ref to the PR head SHA (${HEAD_SHA_REF})`);
          else if (w.repository !== undefined && !norm(w.ref)) err(`${label}: an external checkout must pin ref`);
          if (w['persist-credentials'] !== false) err(`${label}: checkout must set persist-credentials: false`);
        }
      }
      if (step.run !== undefined && EXECUTES_CHECKOUT.test(withoutComments(step.run))) {
        err(`${label}: run step executes code from the checkout (privileged workflows may only read PR code)`);
      }
    }
  }
  return errors;
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
  const dir = process.argv[2] ?? '.github';
  const errors = checkGithubDir(dir);
  if (errors.length) {
    for (const e of errors) console.error(`::error title=workflow policy::${e}`);
    process.exit(1);
  }
  console.log(`workflow policy: OK (${dir})`);
}
