// Privileged workflows (pull_request_target / issue_comment): allowed only for ecc-review.yml and
// auto-merge.yml, and only while they keep their guards (OpenSpec change adopt-ecc-review-and-auto-merge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorkflow, checkZizmorConfig } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const ecc = real('ecc-review.yml');
const am = real('auto-merge.yml');

const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};

test('the committed privileged workflows pass', () => {
  assert.deepEqual(errs('ecc-review.yml', ecc), []);
  assert.deepEqual(errs('auto-merge.yml', am), []);
});

test('any other workflow using pull_request_target or issue_comment fails', () => {
  expectError('ci.yml', am, /pull_request_target.*only allowed in/);
  expectError('review.yml', ecc, /pull_request_target.*only allowed in/);
  expectError('ci.yml', ecc, /issue_comment.*only allowed in/);
});

test('workflow_run stays forbidden even in privileged files', () => {
  expectError('auto-merge.yml', replaceOnce(am, '  pull_request_target:\n', '  workflow_run:\n    workflows: [CI]\n  pull_request_target:\n'), /workflow_run/);
});

test('a privileged file may not add other triggers', () => {
  expectError('auto-merge.yml', replaceOnce(am, 'on:\n', 'on:\n  issue_comment:\n'), /trigger 'issue_comment' is not allowed in auto-merge\.yml/);
  expectError('ecc-review.yml', replaceOnce(ecc, 'on:\n', 'on:\n  push:\n'), /trigger 'push' is not allowed/);
});

test('ecc-review: removing the fork refusal fails', () => {
  const noGuard = replaceOnce(ecc, '        if: github.event.pull_request.head.repo.full_name != github.repository\n', '');
  expectError('ecc-review.yml', noGuard, /job 'review'.*refuse fork/);
});

test('ecc-review: moving the fork refusal after another step fails', () => {
  const steps = ecc.indexOf('      - name: Refuse fork PRs');
  const second = ecc.indexOf('      - name: Require a Claude credential');
  const third = ecc.indexOf('      # pull_request_target checks out main by default');
  const moved = ecc.slice(0, steps) + ecc.slice(second, third) + ecc.slice(steps, second) + ecc.slice(third);
  expectError('ecc-review.yml', moved, /job 'review'.*refuse fork/);
});

test('auto-merge: dropping the same-repo condition fails', () => {
  expectError('auto-merge.yml', replaceOnce(am, '      && github.event.pull_request.head.repo.full_name == github.repository\n', ''), /job 'auto-merge'.*refuse fork/);
});

test('auto-merge: any checkout fails', () => {
  const withCheckout = replaceOnce(am, '    steps:\n', '    steps:\n      - name: Checkout\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n');
  expectError('auto-merge.yml', withCheckout, /must not check out code/);
});

test('ecc-review: checking out anything but the head SHA of this repo, or persisting credentials, fails', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, 'ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.head.ref }}'), /head SHA/);
  expectError('ecc-review.yml', replaceOnce(ecc, '          submodules: false\n          persist-credentials: false\n', '          submodules: false\n'), /persist-credentials/);
});

test('ecc-review: a run step executing files from the checkout fails', () => {
  for (const cmd of ['./scripts/check-licenses.sh', 'bash scripts/x.sh', 'node .github/scripts/pr-title.mjs', 'npm ci', 'pnpm install',
    'python3 tools/recover/x.py', 'make', 'source .env', 'uv run pytest', 'forge build', 'sh x.sh', '. ./env.sh', 'npx foo']) {
    const bad = replaceOnce(ecc, '        run: rm -rf .ecc-plugin\n', `        run: rm -rf .ecc-plugin && ${cmd}\n`);
    expectError('ecc-review.yml', bad, /executes code from the checkout/);
  }
});

test('privileged files may use only the allow-listed actions, never local ones', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, 'uses: anthropics/claude-code-action@', 'uses: ./.github/actions/review # '), /local action/);
  expectError('ecc-review.yml', replaceOnce(ecc, 'uses: anthropics/claude-code-action@', 'uses: someone/other-action@'), /not allow-listed/);
});

test('write scopes are limited per file and job', () => {
  expectError('auto-merge.yml', replaceOnce(am, '      pull-requests: write # enable/disable auto-merge on the PR\n', '      pull-requests: write\n      actions: write\n'), /job 'auto-merge'.*actions: write/);
  expectError('ecc-review.yml', replaceOnce(ecc, '      contents: read # read the PR head and the plugin\n', '      contents: write\n'), /job 'review'.*contents: write/);
  expectError('ecc-review.yml', replaceOnce(ecc, '      pull-requests: read # read the PR\'s head repository and commit\n', '      pull-requests: write\n'), /job 'rerun'.*pull-requests: write/);
});

test('top-level permissions of a privileged file must be {}', () => {
  expectError('auto-merge.yml', replaceOnce(am, 'permissions: {} # the job lists exactly what it needs', 'permissions:\n  contents: read'), /top-level permissions must be \{\}/);
});

test('ecc-review: the comment-triggered job must stay owner-only and check out nothing', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, "      && github.event.comment.author_association == 'OWNER'\n", ''), /job 'rerun'.*OWNER/);
  const withCheckout = replaceOnce(ecc, '      - name: Re-run this PR\'s ECC review\n', '      - name: Checkout\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - name: Re-run this PR\'s ECC review\n');
  expectError('ecc-review.yml', withCheckout, /job 'rerun'.*must not use actions/);
});

test('third-party secrets are only allowed at step level; GITHUB_TOKEN at job level only without checkout', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '      PR: ${{ github.event.pull_request.number }}\n      HEAD_SHA', '      KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n      PR: ${{ github.event.pull_request.number }}\n      HEAD_SHA'), /job 'review'.*job-level env/);
  expectError('ecc-review.yml', replaceOnce(ecc, '      PR: ${{ github.event.pull_request.number }}\n      HEAD_SHA', '      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n      PR: ${{ github.event.pull_request.number }}\n      HEAD_SHA'), /job 'review'.*job-level env/);
  expectError('ecc-review.yml', replaceOnce(ecc, 'env:\n  # ECC', 'env:\n  KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n  # ECC'), /workflow-level env/);
});

// ---- Security review (adopt-ecc-review-and-auto-merge) M1/H1/H2: guards the first version did not hold. ----

test('H1: the agent tool lists are exact (no Bash, writes only the two output files)', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '--allowedTools "Agent,Read,', '--allowedTools "Bash,Agent,Read,'), /allowedTools/);
  expectError('ecc-review.yml', replaceOnce(ecc, 'Edit(//home/runner/work/_temp/ecc-review/body.md)', 'Edit(//home/runner/work/_temp/ecc-review/**)'), /allowedTools/);
  expectError('ecc-review.yml', replaceOnce(ecc, 'Grep(./.git/**),Glob(./.git/**)', 'Grep(./.git/**)'), /disallowedTools/);
  expectError('ecc-review.yml', replaceOnce(ecc, '--max-turns 80', '--max-turns 80 --dangerously-skip-permissions'), /claude_args/);
});

test('H1: plugin hooks stay off (emptied hooks.json and ECC_HOOKS_ENABLED=false) and the env scrub stays on', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '          ECC_HOOKS_ENABLED: "false"\n', ''), /ECC_HOOKS_ENABLED/);
  expectError('ecc-review.yml', replaceOnce(ecc, '          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"\n', ''), /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB/);
  expectError('ecc-review.yml', replaceOnce(ecc, `          printf '{"hooks":{}}\\n' > "$RUNNER_TEMP/ecc-plugin/hooks/hooks.json"\n`, ''), /hooks\.json/);
});

test('H2: auto-merge must exclude Dependabot and non-default base branches', () => {
  expectError('auto-merge.yml', replaceOnce(am, "      && github.event.pull_request.user.login != 'dependabot[bot]'\n", ''), /dependabot/);
  expectError('auto-merge.yml', replaceOnce(am, '      && github.event.pull_request.base.ref == github.event.repository.default_branch\n', ''), /default_branch/);
});

test('M1: fork refusal cannot be defeated by continue-on-error, always(), a fake exit, or an OR', () => {
  const refusal = '        if: github.event.pull_request.head.repo.full_name != github.repository\n';
  expectError('ecc-review.yml', replaceOnce(ecc, refusal, `${refusal}        continue-on-error: true\n`), /continue-on-error/);
  expectError('ecc-review.yml', replaceOnce(ecc, '      - name: Check out the PR head (read only)\n', '      - name: Check out the PR head (read only)\n        if: always()\n'), /always\(\)/);
  expectError('ecc-review.yml', replaceOnce(ecc, '          exit 1\n\n      - name: Require a Claude credential', '          echo "exit 1"\n\n      - name: Require a Claude credential'), /refuse fork/);
  expectError('auto-merge.yml', replaceOnce(am, '      && github.event.pull_request.head.repo.full_name == github.repository\n', '      && github.event.pull_request.head.repo.full_name == github.repository || true\n'), /\|\|/);
  expectError('ecc-review.yml', replaceOnce(ecc, "      && github.event.comment.author_association == 'OWNER'\n", "      && github.event.comment.author_association == 'OWNER' || true\n"), /\|\|/);
  expectError('ecc-review.yml', replaceOnce(ecc, "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    continue-on-error: true\n"), /continue-on-error/);
});

test('M1: custom shells and run defaults are forbidden', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '        run: rm -rf .ecc-plugin\n', '        shell: bash -e evil.sh {0}\n        run: rm -rf .ecc-plugin\n'), /shell/);
  expectError('auto-merge.yml', replaceOnce(am, '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    defaults:\n      run:\n        shell: bash -e evil.sh {0}\n'), /defaults/);
});

test('M1: checkouts are pinned: this repo only at the head SHA, the plugin only via literal env pins', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '          ref: ${{ github.event.pull_request.head.sha }}\n', '          repository: ${{ github.repository }}\n          ref: refs/pull/1/merge\n'), /checkout/);
  expectError('ecc-review.yml', replaceOnce(ecc, '          repository: ${{ env.ECC_REPO }}\n', '          repository: ${{ github.event.pull_request.head.repo.full_name }}\n'), /checkout/);
  expectError('ecc-review.yml', replaceOnce(ecc, '  ECC_SHA: c05b2d6614f62f6db0047669aa4eefb223d478f9\n', '  ECC_SHA: main\n'), /ECC_SHA/);
});

test('M1: run steps are pinned by digest; any edit needs a reviewed digest update', () => {
  expectError('ecc-review.yml', replaceOnce(ecc, '        run: rm -rf .ecc-plugin\n', '        run: rm -rf .ecc-plugin && echo hi\n'), /digest/);
  expectError('auto-merge.yml', replaceOnce(am, '          set -euo pipefail\n', '          set -euo pipefail\n          true\n'), /digest/);
});

test('M1: denylist also catches interpreters and git hook/fsmonitor tricks', () => {
  for (const cmd of ['perl x.pl', 'ruby x.rb', '/bin/sh x', 'bash -e x.sh', 'git -c core.hooksPath=. status', 'awk -f x.awk', 'bunx foo', 'env ./x', 'xargs sh']) {
    const bad = replaceOnce(ecc, '        run: rm -rf .ecc-plugin\n', `        run: rm -rf .ecc-plugin && ${cmd}\n`);
    expectError('ecc-review.yml', bad, /executes code from the checkout/);
  }
});

test('zizmor ignores: only dangerous-triggers, only the two privileged files, pinned to a line', () => {
  const base = 'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": hash-pin\n';
  const ok = `${base}  dangerous-triggers:\n    ignore:\n      - ecc-review.yml:29\n      - auto-merge.yml:12\n`;
  assert.deepEqual(checkZizmorConfig(ok), []);
  assert.match(checkZizmorConfig(`${base}  dangerous-triggers:\n    ignore:\n      - ci.yml:3\n`).join(), /dangerous-triggers/);
  assert.match(checkZizmorConfig(`${base}  dangerous-triggers:\n    ignore:\n      - ecc-review.yml\n`).join(), /dangerous-triggers/);
  assert.match(checkZizmorConfig(`${base}  template-injection:\n    ignore:\n      - ecc-review.yml:40\n`).join(), /template-injection/);
  assert.deepEqual(checkZizmorConfig(readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8')), []);
});
