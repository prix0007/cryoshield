// gate-external-pr-automation: ecc-review (Claude credential) and auto-merge run automatically only for trusted
// authors (the repository owner, or a login in .github/trusted-authors.json on the default branch). Anyone else
// fails the required ecc-review check until the owner comments /ecc-review after the run's event; auto-merge stays off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { AUTO_MERGE_GATE_STEP, ECC_GATE_STEP, checkGithubDir, checkTrustedAuthors, checkWorkflow } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const ecc = real('ecc-review.yml');
const am = real('auto-merge.yml');
const trustedText = readFileSync(new URL('../../trusted-authors.json', import.meta.url), 'utf8');
const stub = fileURLToPath(new URL('./fixtures/gh-gate-stub.sh', import.meta.url));

const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
// The YAML block of one step (from its "- name:" line to the next step), for move/delete mutations.
const stepBlock = (text, name) => {
  const start = text.indexOf(`      - name: ${name}\n`);
  assert.ok(start > 0, `step ${name} not found`);
  // Include the comment block directly above the step, if any.
  let from = start;
  const lines = text.slice(0, start).split('\n');
  lines.pop();
  while (lines.length && /^\s*#/.test(lines[lines.length - 1])) from -= lines.pop().length + 1;
  const next = text.slice(start + 1).search(/\n(      - name: |      # |\n  [a-z])/);
  const end = next < 0 ? text.length : start + 1 + next + 1;
  return text.slice(from, end);
};

// ---------------------------------------------------------------- policy: the committed files pass

test('the committed workflows and trusted-authors.json pass the policy', () => {
  assert.deepEqual(errs('ecc-review.yml', ecc), []);
  assert.deepEqual(errs('auto-merge.yml', am), []);
  assert.deepEqual(checkTrustedAuthors(trustedText), []);
  assert.deepEqual(JSON.parse(trustedText), ['prix0007', 'cryoshield']); // the owner and the Write-only machine account (docs/agent-account.md)
  assert.deepEqual(checkGithubDir(fileURLToPath(new URL('../../', import.meta.url))), []);
});

test('ecc-review: the gate is step 2, right after the fork refusal and before the credential and every checkout', () => {
  const steps = parse(ecc).jobs.review.steps;
  assert.match(steps[0].name, /^Refuse fork PRs/);
  assert.equal(steps[1].name, ECC_GATE_STEP);
  assert.equal(steps[2].name, 'Require a Claude credential');
  assert.ok(steps.slice(0, 2).every((s) => s.uses === undefined));
});

test('auto-merge: the gate is step 1 and the enable step is guarded by its output', () => {
  const steps = parse(am).jobs['auto-merge'].steps;
  assert.equal(steps[0].name, AUTO_MERGE_GATE_STEP);
  assert.equal(steps[0].id, 'author');
  assert.ok(steps.length >= 2);
  for (const s of steps.slice(1)) assert.equal(s.if, "steps.author.outputs.trusted == 'true'");
});

// ---------------------------------------------------------------- policy: mutations are rejected

test('ecc-review: removing the gate fails', () => {
  expectError('ecc-review.yml', ecc.replace(stepBlock(ecc, ECC_GATE_STEP), ''), /trusted-author gate/);
});

test('ecc-review: renaming the gate fails', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, `      - name: ${ECC_GATE_STEP}\n`, '      - name: Check the author\n'), /trusted-author gate/);
});

test('ecc-review: moving the gate after the credential step or a checkout fails', () => {
  const gate = stepBlock(ecc, ECC_GATE_STEP);
  const without = ecc.replace(gate, '');
  for (const anchor of ['      - name: Assert no git credentials remain in .git/config\n', '      - name: Install bubblewrap for credential isolation\n']) {
    expectError('ecc-review.yml', replaceOnce(without, anchor, gate + anchor), /trusted-author gate.*step 2/);
  }
});

test('ecc-review: a condition on the gate fails (it must never be skipped)', () => {
  for (const cond of ["github.event.pull_request.user.login != 'x'", 'false', "github.actor == 'prix0007'"]) {
    expectError('ecc-review.yml', replaceOnce(ecc, `      - name: ${ECC_GATE_STEP}\n`, `      - name: ${ECC_GATE_STEP}\n        if: ${cond}\n`), /trusted-author gate.*if/);
  }
});

test('ecc-review: the gate inputs are exact (author, owner, event time, default branch, token)', () => {
  const mutations = [
    ['          AUTHOR: ${{ github.event.pull_request.user.login }}\n', '          AUTHOR: ${{ github.actor }}\n'],
    ['          OWNER: ${{ github.repository_owner }}\n', "          OWNER: ${{ github.event.pull_request.user.login }}\n"],
    ['          PR_UPDATED_AT: ${{ github.event.pull_request.updated_at }}\n', "          PR_UPDATED_AT: '1970-01-01T00:00:00Z'\n"],
    ['          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}\n', '          DEFAULT_BRANCH: ${{ github.event.pull_request.head.ref }}\n'],
    ['          PR_UPDATED_AT: ${{ github.event.pull_request.updated_at }}\n', '          PR_UPDATED_AT: ${{ github.event.pull_request.updated_at }}\n          EXTRA: x\n'],
    ['          SENDER: ${{ github.event.sender.login }}\n', '          SENDER: ${{ github.event.pull_request.user.login }}\n'],
  ];
  const gate = stepBlock(ecc, ECC_GATE_STEP);
  for (const [from, to] of mutations) {
    expectError('ecc-review.yml', ecc.replace(gate, replaceOnce(gate, from, to)), /trusted-author gate.*env/);
  }
});

test('ecc-review: the gate must fail closed (exit 1) and stays digest-pinned', () => {
  const gate = stepBlock(ecc, ECC_GATE_STEP);
  const noExit = gate.replace(/\n {10}exit 1\n/, '\n          exit 0\n');
  assert.notEqual(noExit, gate);
  expectError('ecc-review.yml', ecc.replace(gate, noExit), /trusted-author gate.*exit 1/);
  expectError('ecc-review.yml', ecc.replace(gate, replaceOnce(gate, '          set -euo pipefail\n', '          set -euo pipefail\n          true\n')), /digest/);
});

test('auto-merge: removing, moving or renaming the gate fails', () => {
  const gate = stepBlock(am, AUTO_MERGE_GATE_STEP);
  expectError('auto-merge.yml', am.replace(gate, ''), /trusted-author gate/);
  expectError('auto-merge.yml', replaceOnce(am, `      - name: ${AUTO_MERGE_GATE_STEP}\n`, '      - name: Who\n'), /trusted-author gate/);
  // After the enable step.
  const moved = am.replace(gate, '') + gate.replace(/\n$/, '') + '\n';
  expectError('auto-merge.yml', moved, /trusted-author gate.*step 1/);
});

test('auto-merge: the gate id and the guard on later steps are required', () => {
  expectError('auto-merge.yml', replaceOnce(am, '        id: author\n', '        id: who\n'), /trusted-author gate.*id/);
  expectError('auto-merge.yml', replaceOnce(am, "        if: steps.author.outputs.trusted == 'true'\n", ''), /steps\.author\.outputs\.trusted/);
  expectError('auto-merge.yml', replaceOnce(am, "        if: steps.author.outputs.trusted == 'true'\n", "        if: steps.author.outputs.trusted == 'true' || true\n"), /steps\.author\.outputs\.trusted/);
  expectError('auto-merge.yml', replaceOnce(am, '          OWNER: ${{ github.repository_owner }}\n', '          OWNER: ${{ github.event.pull_request.user.login }}\n'), /trusted-author gate.*env/);
  expectError('auto-merge.yml', replaceOnce(am, '          SENDER: ${{ github.event.sender.login }}\n', ''), /trusted-author gate.*env/);
  expectError('auto-merge.yml', replaceOnce(am, '        id: author\n', '        id: author\n        working-directory: pr\n'), /trusted-author gate.*working-directory/);
});

test('auto-merge: it re-checks on every push (synchronize), so a non-trusted push switches auto-merge off (H2)', () => {
  assert.ok(parse(am).on.pull_request_target.types.includes('synchronize'));
});

// ---------------------------------------------------------------- policy: trusted-authors.json

test('trusted-authors.json: GitHub logins only, unique, no bots, no wildcards, 1..20 entries', () => {
  assert.deepEqual(checkTrustedAuthors('["prix0007", "cryoshield-agent"]'), []);
  for (const bad of ['{}', '[]', '"prix0007"', '[1]', '["dependabot[bot]"]', '["*"]', '["prix0007", "PRIX0007"]', '["-x"]', '["a--"]', '["a b"]',
    'not json', JSON.stringify(Array.from({ length: 21 }, (_, i) => `u${i}`)), '["github-actions[bot]"]', `["${'a'.repeat(40)}"]`]) {
    assert.ok(checkTrustedAuthors(bad).length > 0, bad);
  }
});

test('checkGithubDir requires a valid trusted-authors.json when a gated workflow exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-dir-'));
  mkdirSync(join(dir, 'workflows'));
  writeFileSync(join(dir, 'zizmor.yml'), readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8'));
  writeFileSync(join(dir, 'workflows', 'auto-merge.yml'), am);
  assert.match(checkGithubDir(dir).join('\n'), /trusted-authors\.json.*missing/);
  writeFileSync(join(dir, 'trusted-authors.json'), '["dependabot[bot]"]');
  assert.match(checkGithubDir(dir).join('\n'), /trusted-authors\.json/);
  writeFileSync(join(dir, 'trusted-authors.json'), trustedText);
  assert.ok(!checkGithubDir(dir).some((e) => /trusted-authors/.test(e)));
});

// ---------------------------------------------------------------- behaviour: run the gate scripts against a stub gh

const runOf = (text, job, name) => parse(text).jobs[job].steps.find((s) => s.name === name).run;
const EVENT_AT = '2026-10-06T10:00:00Z';
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
// The owner approves one head commit: "/ecc-review <sha prefix, 7-40 hex>" (security review H3).
const APPROVE = '/ecc-review abcdef1';
const LATER = '2026-10-06T10:05:00Z';
const comment = (login, body, at, assoc = login === 'prix0007' ? 'OWNER' : 'CONTRIBUTOR', updated = at) => ({ user: { login, type: 'User' }, author_association: assoc, body, created_at: at, updated_at: updated });

function gate(which, { author, sender = author, list = '["prix0007"]', comments = [], attempt = '2', env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  copyFileSync(stub, join(bin, 'gh'));
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(dir, 'gh.log');
  const out = join(dir, 'output');
  writeFileSync(out, '');
  const script = which === 'ecc' ? runOf(ecc, 'review', ECC_GATE_STEP) : runOf(am, 'auto-merge', AUTO_MERGE_GATE_STEP);
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: log,
      GITHUB_OUTPUT: out,
      GITHUB_REPOSITORY: 'prix0007/cryoshield',
      GH_REPO: 'prix0007/cryoshield',
      PR: '42',
      AUTHOR: author,
      SENDER: sender,
      HEAD_SHA: HEAD,
      GITHUB_RUN_ATTEMPT: attempt,
      OWNER: 'prix0007',
      PR_UPDATED_AT: EVENT_AT,
      DEFAULT_BRANCH: 'main',
      GH_TOKEN: 'x',
      STUB_LIST: list,
      STUB_COMMENTS: JSON.stringify(comments),
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { ...r, calls, output: readFileSync(out, 'utf8') };
}

test('ecc gate: the owner passes without any API call (case-insensitive)', () => {
  for (const author of ['prix0007', 'Prix0007']) {
    const r = gate('ecc', { author });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(r.calls, []);
  }
});

test('ecc gate: a listed author passes; the list is read from the default branch, never the PR', () => {
  const r = gate('ecc', { author: 'Cryoshield-Agent', list: '["prix0007","cryoshield-agent"]' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0], /repos\/prix0007\/cryoshield\/contents\/\.github\/trusted-authors\.json\?ref=main$/);
});

test('ecc gate: an unlisted author fails at once with "Awaiting owner approval"', () => {
  for (const author of ['someone', 'dependabot[bot]', 'cryoshield-agent']) {
    const r = gate('ecc', { author });
    assert.equal(r.status, 1, author);
    assert.match(r.stdout, /::error title=Awaiting owner approval::/);
    assert.match(r.stdout, /\/ecc-review/);
  }
});

test('ecc gate: an owner /ecc-review comment newer than the event approves the run', () => {
  const r = gate('ecc', { author: 'someone', comments: [comment('prix0007', APPROVE, LATER)] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.calls.some((c) => /issues\/42\/comments\?since=2026-10-06T10:00:00Z/.test(c)), r.calls.join('\n'));
});

test('ecc gate: a comment from a deleted account or with no body does not break an approval', () => {
  const ghost = { user: null, author_association: 'NONE', body: null, created_at: '2026-10-06T10:01:00Z' };
  const r = gate('ecc', { author: 'someone', comments: [ghost, comment('prix0007', APPROVE, LATER)] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const none = gate('ecc', { author: 'someone', comments: [ghost] });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Awaiting owner approval/);
});

test('ecc gate: a full head SHA, any case, also approves', () => {
  for (const body of [`/ecc-review ${HEAD}`, '/ecc-review ABCDEF1', '/ecc-review abcdef1 looks fine']) {
    const r = gate('ecc', { author: 'someone', comments: [comment('prix0007', body, LATER)] });
    assert.equal(r.status, 0, body + r.stderr + r.stdout);
  }
});

test('ecc gate: a push by a non-trusted sender to a trusted author\'s PR needs approval (H2)', () => {
  const r = gate('ecc', { author: 'prix0007', sender: 'someone' });
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /Awaiting owner approval/);
  const listed = gate('ecc', { author: 'cryoshield-agent', sender: 'someone', list: '["prix0007","cryoshield-agent"]' });
  assert.equal(listed.status, 1);
  const ok = gate('ecc', { author: 'prix0007', sender: 'someone', comments: [comment('prix0007', APPROVE, LATER)] });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  const agentPushesOwnerPr = gate('ecc', { author: 'prix0007', sender: 'cryoshield-agent', list: '["prix0007","cryoshield-agent"]' });
  assert.equal(agentPushesOwnerPr.status, 0, agentPushesOwnerPr.stderr);
});

test('ecc gate: every re-run attempt needs its own owner approval, so UI re-runs cannot spend the credential (H3b)', () => {
  const one = [comment('prix0007', APPROVE, LATER)];
  const two = [...one, comment('prix0007', APPROVE, '2026-10-06T10:07:00Z')];
  assert.equal(gate('ecc', { author: 'someone', comments: one, attempt: '2' }).status, 0);
  assert.equal(gate('ecc', { author: 'someone', comments: one, attempt: '3' }).status, 1);
  assert.equal(gate('ecc', { author: 'someone', comments: two, attempt: '3' }).status, 0);
  assert.equal(gate('ecc', { author: 'someone', comments: one, attempt: '1' }).status, 0);
  // Trusted authors are not counted.
  assert.equal(gate('ecc', { author: 'prix0007', attempt: '9' }).status, 0);
});

test('ecc gate: a missing event time or head SHA fails closed (L3)', () => {
  for (const env of [{ PR_UPDATED_AT: '' }, { HEAD_SHA: '' }]) {
    const r = gate('ecc', { author: 'someone', comments: [comment('prix0007', APPROVE, LATER)], env });
    assert.notEqual(r.status, 0, JSON.stringify(env));
  }
});

test('ecc gate: stale, foreign or non-command comments do not approve', () => {
  const cases = [
    [comment('prix0007', APPROVE, '2026-10-06T09:59:59Z')], // before the push: approved an older commit
    [comment('prix0007', APPROVE, EVENT_AT)], // same second is not "after"
    [comment('someone', APPROVE, LATER)],
    [comment('someone', APPROVE, LATER, 'OWNER')], // association alone is not enough
    [comment('prix0007', APPROVE, LATER, 'COLLABORATOR')], // login alone is not enough
    [comment('prix0007', `please ${APPROVE}`, LATER)],
    [comment('prix0007', `LGTM\n${APPROVE}`, LATER)], // the command must start the comment, not a later line
    [comment('prix0007', 'LGTM', LATER)],
    [comment('prix0007', '/ecc-review', LATER)], // no commit: a bare /ecc-review only re-runs trusted PRs (H3)
    [comment('prix0007', '/ecc-review abcdef', LATER)], // fewer than 7 hex digits
    [comment('prix0007', '/ecc-review 1234567', LATER)], // another commit (H3a: replay onto an old head)
    [comment('prix0007', '/ecc-review abcdef1x', LATER)],
    [comment('prix0007', APPROVE, LATER, 'OWNER', '2026-10-06T10:06:00Z')], // edited, e.g. by a Write user (H1)
  ];
  for (const comments of cases) {
    const r = gate('ecc', { author: 'someone', comments });
    assert.equal(r.status, 1, JSON.stringify(comments));
    assert.match(r.stdout, /Awaiting owner approval/);
  }
});

test('ecc gate: API errors and a malformed list fail closed', () => {
  for (const opts of [
    { env: { STUB_LIST_FAIL: '1' } },
    { env: { STUB_COMMENTS_FAIL: '1' }, comments: [comment('prix0007', APPROVE, LATER)] },
    { list: '{"someone": true}' },
    { list: '"someone"' },
    { list: 'not json' },
    { list: '[1, "someone"]' },
  ]) {
    const r = gate('ecc', { author: 'someone', ...opts });
    assert.notEqual(r.status, 0, JSON.stringify(opts));
  }
});

test('auto-merge gate: owner and listed authors are trusted', () => {
  const owner = gate('am', { author: 'prix0007' });
  assert.equal(owner.status, 0, owner.stderr);
  assert.equal(owner.output.trim(), 'trusted=true');
  assert.deepEqual(owner.calls, []);
  const listed = gate('am', { author: 'cryoshield-agent', list: '["prix0007","cryoshield-agent"]' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.output.trim(), 'trusted=true');
  assert.ok(!listed.calls.some((c) => /pr merge/.test(c)));
});

test('auto-merge gate: anyone else is untrusted, auto-merge is switched off, and the step still succeeds', () => {
  for (const author of ['someone', 'dependabot[bot]']) {
    const r = gate('am', { author, comments: [comment('prix0007', APPROVE, LATER)] });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output.trim(), 'trusted=false');
    assert.ok(r.calls.includes('pr merge 42 --disable-auto'), r.calls.join('\n'));
    assert.match(r.stdout, /::notice::.*not a trusted author/);
    // An /ecc-review approval is for the review only; it never turns auto-merge on.
    assert.ok(!r.calls.some((c) => /comments/.test(c)));
  }
});

test('auto-merge gate: an unreadable or malformed list never yields trusted=true, still switches auto-merge off, and fails (L1)', () => {
  for (const opts of [{ env: { STUB_LIST_FAIL: '1' } }, { list: '{}' }, { list: 'nope' }]) {
    const r = gate('am', { author: 'someone', ...opts });
    assert.doesNotMatch(r.output, /trusted=true/, JSON.stringify(opts));
    assert.ok(r.calls.includes('pr merge 42 --disable-auto'), JSON.stringify(opts) + r.calls.join('\n'));
    assert.notEqual(r.status, 0, JSON.stringify(opts));
  }
});

test('auto-merge gate: a push by a non-trusted sender to a trusted PR switches auto-merge off (H2)', () => {
  const r = gate('am', { author: 'prix0007', sender: 'someone' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output.trim(), 'trusted=false');
  assert.ok(r.calls.includes('pr merge 42 --disable-auto'));
});
