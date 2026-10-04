// add-issue-triage: issue-triage.yml is a privileged workflow (issues/issue_comment run with secrets for anyone);
// these tests mutate the real file and each mutation must be rejected by workflow-policy.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorkflow } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const triage = real('issue-triage.yml');
const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
const replaceAll = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.split(from).join(to);
};

test('the committed issue-triage.yml passes', () => {
  assert.deepEqual(errs('issue-triage.yml', triage), []);
});

test('no other workflow may use the issues trigger', () => {
  expectError('ci.yml', triage, /issues trigger is only allowed in/);
});

test('checkouts: default branch only (no ref), never persisted credentials', () => {
  expectError('issue-triage.yml', replaceOnce(triage, '          persist-credentials: false\n          sparse-checkout: .github/scripts\n',
    '          persist-credentials: false\n          sparse-checkout: .github/scripts\n          ref: refs/pull/1/head\n'), /default branch/);
  expectError('issue-triage.yml', replaceOnce(triage, '          persist-credentials: false\n      - name: Assert no git credentials', '      - name: Assert no git credentials'), /persist-credentials/);
});

test('every job keeps the no-PR and no-bot conjuncts; comment re-runs stay OWNER-only', () => {
  expectError('issue-triage.yml', replaceOnce(triage, "      && !github.event.issue.pull_request\n      && github.event.sender.type != 'Bot'\n      && github.event.issue.user.login != 'github-actions[bot]'\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5", "      && github.event.sender.type != 'Bot'\n      && github.event.issue.user.login != 'github-actions[bot]'\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5"), /job 'ack'.*pull_request/);
  expectError('issue-triage.yml', replaceAll(triage, " && github.event.comment.author_association == 'OWNER'", ''), /job 'screen'.*OWNER/);
  expectError('issue-triage.yml', replaceAll(triage, "      && github.event.sender.type != 'Bot'\n", ''), /Bot/);
});

test('no top-level || in a job condition', () => {
  expectError('issue-triage.yml', replaceOnce(triage, "      && needs.screen.outputs.verdict == 'ok'\n", "      && needs.screen.outputs.verdict == 'ok' || true\n"), /\|\|/);
});

test('secrets other than GITHUB_TOKEN only in the diagnose job', () => {
  expectError('issue-triage.yml', replaceOnce(triage, '          AUTHOR: ${{ github.event.issue.user.login }}\n          AUTHOR_IS_OWNER', '          AUTHOR: ${{ github.event.issue.user.login }}\n          K: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n          AUTHOR_IS_OWNER'), /job 'screen'.*diagnose/);
});

test('the agent tool lists are exact; hooks stay off; non-write users only with that sandbox', () => {
  expectError('issue-triage.yml', replaceOnce(triage, '--allowedTools "Agent,', '--allowedTools "Bash,Agent,'), /allowedTools/);
  expectError('issue-triage.yml', replaceOnce(triage, 'Edit(//home/runner/work/_temp/triage/labels.txt)', 'Edit(//home/runner/work/_temp/triage/**)'), /allowedTools/);
  expectError('issue-triage.yml', replaceOnce(triage, '          ECC_HOOKS_ENABLED: "false"\n', ''), /ECC_HOOKS_ENABLED/);
  expectError('issue-triage.yml', replaceOnce(triage, `          printf '{"hooks":{}}\\n' > "$RUNNER_TEMP/ecc-plugin/hooks/hooks.json"\n`, ''), /hooks\.json/);
});

test('run steps are digest-pinned; only the triage script may be run with node', () => {
  expectError('issue-triage.yml', replaceOnce(triage, 'echo "screen passed"; exit 0 ;;', 'echo "screen passed!"; exit 0 ;;'), /digest/);
  expectError('issue-triage.yml', replaceOnce(triage, '        run: rm -rf .ecc-plugin\n', '        run: rm -rf .ecc-plugin && node .github/scripts/other.mjs\n'), /executes code/);
});

test('review M3: the triage agent output is never published unchecked (display_report false)', () => {
  expectError('issue-triage.yml', replaceOnce(triage, '          display_report: false\n', '          display_report: true\n'), /display_report/);
});

test('review L3: no interpreter-hijacking env keys in privileged workflows', () => {
  for (const key of ['NODE_OPTIONS', 'BASH_ENV', 'LD_PRELOAD', 'PATH']) {
    expectError('issue-triage.yml', replaceOnce(triage, '          GL_RC: ${{ steps.gitleaks.outputs.rc }}\n', `          GL_RC: \${{ steps.gitleaks.outputs.rc }}\n          ${key}: x\n`), new RegExp(key));
  }
  expectError('issue-triage.yml', replaceOnce(triage, '      ISSUE: ${{ github.event.issue.number }}\n      AUTHOR:', '      ISSUE: ${{ github.event.issue.number }}\n      NODE_OPTIONS: --require x\n      AUTHOR:'), /NODE_OPTIONS/);
});

test('ecc-review.yml may not use allowed_non_write_users (only the triage sandbox may)', () => {
  const ecc = real('ecc-review.yml');
  expectError('ecc-review.yml', replaceOnce(ecc, '          display_report: true\n', '          display_report: true\n          allowed_non_write_users: "*"\n'), /allowed_non_write_users/);
});
