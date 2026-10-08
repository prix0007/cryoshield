// split-dev-and-release-deploys (spec ci-pipeline "Deploy workflow restrictions per target"; earlier:
// add-continuous-deploy, gate-production-deploys): the restrictions shared by BOTH deploy workflows,
// deploy.yml (production, owner releases) and deploy-dev.yml (development, every main commit), and the reusable
// full CI. Mutates the real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkGithubDir, checkWorkflow, checkZizmorConfig } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const ci = real('ci.yml');
const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
const envOf = (j) => String((typeof j.environment === 'object' ? j.environment?.name : j.environment) ?? '');

const TARGETS = {
  'deploy.yml': { release: 'production', build: 'production-build', other: ['development', 'development-build'], group: 'deploy-production' },
  'deploy-dev.yml': { release: 'development', build: 'development-build', other: ['production', 'production-build'], group: 'deploy-development' },
};
const ALL_ENVS = ['production', 'production-build', 'development', 'development-build'];

test('the committed deploy workflows, ci.yml and the whole .github directory pass the policy', () => {
  for (const f of [...Object.keys(TARGETS), 'ci.yml']) assert.deepEqual(errs(f, real(f)), [], f);
  assert.deepEqual(checkGithubDir(fileURLToPath(new URL('../..', import.meta.url))), []);
});

for (const [file, t] of Object.entries(TARGETS)) {
  const text = real(file);
  const wf = parse(text);

  test(`${file}: never a pull_request, pull_request_target or workflow_call trigger`, () => {
    const firstTrigger = Object.keys(wf.on)[0];
    for (const bad of ['pull_request', 'pull_request_target', 'workflow_call']) {
      expectError(file, replaceOnce(text, `on:\n  ${firstTrigger}:`, `on:\n  ${bad}:\n  ${firstTrigger}:`), new RegExp(`trigger '${bad}'|${bad}`));
    }
  });

  test(`${file}: only ${t.release} and ${t.build}; the other target's environments and unknown ones are refused`, () => {
    const envs = Object.values(wf.jobs).map(envOf).filter(Boolean).sort();
    assert.deepEqual(envs, [t.build, t.build, t.release].sort());
    for (const other of [...t.other, 'staging']) {
      expectError(file, replaceOnce(text, `      name: ${t.release}\n`, `      name: ${other}\n`), /environment/);
      expectError(file, text.replaceAll(`      name: ${t.build} `, `      name: ${other} `), /environment/);
    }
  });

  test(`${file}: exactly one ${t.release} job (release); it holds the token; build jobs never do`, () => {
    const releaseJobs = Object.entries(wf.jobs).filter(([, j]) => envOf(j) === t.release).map(([id]) => id);
    assert.deepEqual(releaseJobs, ['release']);
    for (const [id, j] of Object.entries(wf.jobs)) {
      if (id !== 'release') assert.doesNotMatch(JSON.stringify(j), /FLY_API_TOKEN/, id);
    }
    assert.match(JSON.stringify(wf.jobs.release), /FLY_API_TOKEN/);
    expectError(file, replaceOnce(text, `      name: ${t.build} # build config only`, `      name: ${t.release} # build config only`), /environment|FLY_API_TOKEN|one job/);
  });

  test(`${file}: FLY_API_TOKEN only in the step env of steps deploy and rollback`, () => {
    expectError(file, replaceOnce(text, '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n', '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n          T: ${{ secrets.FLY_API_TOKEN }}\n'), /FLY_API_TOKEN/);
    expectError(file, replaceOnce(text, '    permissions:\n      contents: read # checkout, and the', '    env:\n      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n    permissions:\n      contents: read # checkout, and the'), /FLY_API_TOKEN/);
    expectError(file, replaceOnce(text, 'env:\n  NODE_VERSION:', 'env:\n  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n  NODE_VERSION:'), /FLY_API_TOKEN/);
    expectError(file, replaceOnce(text, '        run: .github/scripts/deploy/rollback.sh\n', '        run: .github/scripts/deploy/rollback.sh "${{ secrets.FLY_API_TOKEN }}"\n'), /FLY_API_TOKEN/);
  });

  test(`${file}: secrets need the target's environments; exact secret expressions only`, () => {
    const noEnv = text.replace(/    environment:\n      name: (production|development)\n      url: [^\n]+\n/, '');
    assert.notEqual(noEnv, text);
    expectError(file, noEnv, /job 'release'/);
    const inject = (expr) => replaceOnce(text, '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n', `          VITE_RP_NAME: \${{ vars.VITE_RP_NAME }}\n          X: \${{ ${expr} }}\n`);
    expectError(file, inject("secrets[format('FLY_{0}','API_TOKEN')]"), /secret/);
    expectError(file, inject('toJSON(secrets)'), /secret/);
    const bundlerElsewhere = replaceOnce(text, '          PREVIOUS_IMAGE: ${{ steps.deploy.outputs.previous_image }}\n', '          PREVIOUS_IMAGE: ${{ steps.deploy.outputs.previous_image }}\n          B: ${{ secrets.VITE_BUNDLER_URL }}\n');
    expectError(file, bundlerElsewhere, /VITE_BUNDLER_URL/);
  });

  test(`${file}: never secrets: inherit; concurrency exact and never cancelled; job-level ${t.group}`, () => {
    expectError(file, replaceOnce(text, '    permissions:\n      contents: read # the called CI', '    secrets: inherit\n    permissions:\n      contents: read # the called CI'), /secrets: inherit/);
    expectError(file, replaceOnce(text, '  cancel-in-progress: false\n', '  cancel-in-progress: true\n'), /concurrency/);
    assert.deepEqual(wf.jobs.release.concurrency, { group: t.group, 'cancel-in-progress': false });
    expectError(file, replaceOnce(text, `      group: ${t.group}\n`, '      group: deploy-${{ github.sha }}\n'), new RegExp(t.group));
    expectError(file, replaceOnce(text, `      group: ${t.group}\n      cancel-in-progress: false\n`, `      group: ${t.group}\n      cancel-in-progress: true\n`), new RegExp(t.group));
  });

  test(`${file}: no write scope on any job (the supersede exception is gone)`, () => {
    expectError(file, replaceOnce(text, '      contents: read # checkout, and the', '      contents: write # checkout, and the'), /write/);
    expectError(file, replaceOnce(text, '    permissions:\n      contents: read # checkout, and the', '    permissions:\n      actions: write\n      contents: read # checkout, and the'), /actions: write/);
    assert.equal(wf.jobs.supersede, undefined);
    for (const [id, j] of Object.entries(wf.jobs)) {
      for (const level of Object.values(j.permissions ?? {})) assert.notEqual(level, 'write', id);
    }
  });

  test(`${file}: the token job runs no build tooling and no third-party action (H1)`, () => {
    const withBuild = replaceOnce(text, '      - name: Deploy the built context (flyctl only)\n', '      - name: Sneaky install\n        run: pnpm install --frozen-lockfile\n      - name: Deploy the built context (flyctl only)\n');
    expectError(file, withBuild, /job 'release'.*no node, npm, pnpm/);
    const withAction = replaceOnce(text, '      - name: Deploy the built context (flyctl only)\n', '      - name: Setup\n        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n      - name: Deploy the built context (flyctl only)\n');
    expectError(file, withAction, /job 'release'.*actions\/setup-node/);
  });

  test(`${file}: build in ${t.build} runs deploy.sh --build-only for its target; release ships only the artifact`, () => {
    assert.equal(envOf(wf.jobs.build), t.build);
    const build = wf.jobs.build.steps.find((s) => s.id === 'build');
    assert.match(String(build.run), /deploy\.sh --build-only/);
    assert.equal(build.env?.DEPLOY_TARGET, file === 'deploy.yml' ? 'production' : 'development');
    assert.ok(wf.jobs.release.steps.some((s) => String(s.uses).startsWith('actions/download-artifact@')));
  });

  test(`${file}: rollback on failure OR cancellation after fly deploy started, in the same job`, () => {
    const rollback = wf.jobs.release.steps.find((s) => s.id === 'rollback');
    assert.match(String(rollback.if), /failure\(\) \|\| cancelled\(\)/);
    assert.match(String(rollback.if), /steps\.deploy\.outputs\.fly_started == 'true'/);
    assert.equal(rollback.env.APP, '${{ env.FLY_APP }}');
    assert.equal(rollback.env.CONFIG, 'apps/web/${{ env.FLY_CONFIG }}');
  });

  test(`${file}: every job with needs is gated on needs.detect.outputs.deploy; no top-level ||`, () => {
    const ungated = replaceOnce(text, "    needs: [detect, build]\n    if: needs.detect.outputs.deploy == 'true'\n", '    needs: [detect, build]\n    if: always()\n');
    expectError(file, ungated, /job 'release'.*needs\.detect\.outputs\.deploy == 'true'/);
    expectError(file, replaceOnce(text, "    if: needs.detect.outputs.deploy == 'true' && needs.config.outputs.configured == 'true'\n    uses:", "    if: needs.detect.outputs.deploy == 'true' && needs.config.outputs.configured == 'true' || true\n    uses:"), /job 'test'.*\|\|/);
  });

  test(`${file}: token-job run steps are digest-pinned, no custom shell`, () => {
    expectError(file, replaceOnce(text, '          fly deploy --config "$FLY_CONFIG" --remote-only --app "$FLY_APP"\n', '          fly deploy --config "$FLY_CONFIG" --remote-only --app "$FLY_APP"\n          true\n'), /digest/);
    expectError(file, replaceOnce(text, '        id: rollback\n', '        id: rollback\n        shell: bash -e {0}\n'), /shell/);
  });

  // harden-release-path D3/D4 (pre-production review L4): the build job publishes the context hashes as job outputs;
  // the release job verifies the downloaded artifact against them (not only against the manifest inside it), and the
  // smoke test compares the live treeHash with the build job's.
  test(`${file}: build publishes the context hashes; release and smoke verify against the build job's outputs`, () => {
    const TREE_OUT = '${{ needs.build.outputs.tree_hash }}';
    const CADDY_OUT = '${{ needs.build.outputs.caddyfile_hash }}';
    assert.deepEqual(wf.jobs.build.outputs, {
      tree_hash: '${{ steps.context-hash.outputs.tree_hash }}',
      caddyfile_hash: '${{ steps.context-hash.outputs.caddyfile_hash }}',
    });
    const bsteps = wf.jobs.build.steps;
    const hash = bsteps.find((s) => s.id === 'context-hash');
    assert.equal(String(hash.run).trim(), '.github/scripts/deploy/verify-context.sh');
    assert.equal(hash.env.ROLE, 'build');
    assert.ok(bsteps.indexOf(hash) > bsteps.findIndex((s) => s.id === 'build'), 'context-hash runs after the build');
    const rsteps = wf.jobs.release.steps;
    const verify = rsteps.find((s) => s.id === 'verify-context');
    assert.equal(String(verify.run).trim(), '.github/scripts/deploy/verify-context.sh');
    assert.equal(verify.env.ROLE, 'release');
    assert.equal(verify.env.EXPECT_TREE_HASH, TREE_OUT);
    assert.equal(verify.env.EXPECT_CADDYFILE_HASH, CADDY_OUT);
    const recheck = file === 'deploy.yml' ? 'tag-check' : 'head-check';
    assert.ok(rsteps.indexOf(verify) < rsteps.findIndex((s) => s.id === recheck), 'verify-context runs before the re-check and deploy');
    assert.equal(rsteps.find((s) => s.id === 'smoke').env.EXPECT_TREE_HASH, TREE_OUT);
    // no expression in any run: block of the new steps (template injection)
    for (const s of [hash, verify]) assert.doesNotMatch(String(s.run), /\$\{\{/);

    // every removal or weakening fails the policy
    const mutations = [
      [replaceOnce(text, "      tree_hash: ${{ steps.context-hash.outputs.tree_hash }}\n", ''), /job 'build'.*outputs/],
      [replaceOnce(text, "      caddyfile_hash: ${{ steps.context-hash.outputs.caddyfile_hash }}\n", ''), /job 'build'.*outputs/],
      [replaceOnce(text, '        id: context-hash\n', ''), /context-hash/],
      [replaceOnce(text, '          ROLE: build\n', '          ROLE: release\n'), /context-hash/],
      [replaceOnce(text, '        id: verify-context\n', ''), /verify-context/],
      [replaceOnce(text, `          EXPECT_TREE_HASH: ${TREE_OUT}\n          EXPECT_CADDYFILE_HASH:`, '          EXPECT_CADDYFILE_HASH:'), /verify-context/],
      [replaceOnce(text, `          EXPECT_CADDYFILE_HASH: ${CADDY_OUT}\n`, '          EXPECT_CADDYFILE_HASH: sha256:0000\n'), /verify-context/],
      [replaceOnce(text, '          ROLE: release\n', '          ROLE: build\n'), /verify-context/],
      [replaceOnce(text, `          EXPECT_TREE_HASH: ${TREE_OUT} # the live /release.json treeHash (harden-release-path D3)\n`, ''), /smoke.*EXPECT_TREE_HASH/],
    ];
    for (const [mutated, why] of mutations) {
      assert.notEqual(mutated, text);
      expectError(file, mutated, why);
    }
  });

  test(`${file}: environment names may not be expressions`, () => {
    expectError(file, replaceOnce(text, `      name: ${t.release}\n`, `      name: \${{ '${t.release}' }}\n`), /expression/);
  });

  test(`${file}: the release job re-checks its commit right before fly deploy`, () => {
    const id = file === 'deploy.yml' ? 'tag-check' : 'head-check';
    const steps = wf.jobs.release.steps;
    const idx = (s) => steps.findIndex((x) => x.id === s);
    assert.ok(idx(id) >= 0 && idx(id) === idx('deploy') - 1, `${id} must run immediately before deploy (ECC L1)`);
    assert.doesNotMatch(JSON.stringify(steps[idx(id)]), /secrets\./);
    const without = text.replace(`        id: ${id}\n`, '');
    assert.notEqual(without, text);
    expectError(file, without, new RegExp(id));
  });
}

for (const [file] of Object.entries(TARGETS)) {
  const text = real(file);
  const wf = parse(text);

  test(`${file}: ECC M3: no always()/failure()/cancelled() in a JOB condition, alone or combined`, () => {
    // case-insensitive, like GitHub's expression functions (ECC M-case)
    for (const fn of ['always()', 'failure()', 'cancelled()', '!cancelled()', 'ALWAYS()', 'Failure()', 'CANCELLED ()']) {
      const combined = replaceOnce(text, "    needs: [detect, build]\n    if: needs.detect.outputs.deploy == 'true'\n", `    needs: [detect, build]\n    if: "${fn} && needs.detect.outputs.deploy == 'true'"\n`);
      expectError(file, combined, /job 'release'.*always\(\), failure\(\) and cancelled\(\)/);
    }
    // the step-level exceptions stay: rollback and fail loudly
    assert.match(String(wf.jobs.release.steps.find((s) => s.id === 'rollback').if), /failure\(\) \|\| cancelled\(\)/);
    assert.deepEqual(errs(file, text), []);
  });

  test(`${file}: ECC M3: every job that needs config must require needs.config.outputs.configured == 'true'`, () => {
    for (const [id, j] of Object.entries(wf.jobs)) {
      if ([].concat(j.needs ?? []).includes('config')) assert.match(String(j.if), /needs\.config\.outputs\.configured == 'true'/, id);
    }
    const unconfigured = replaceOnce(text, "    needs: [detect, config, test]\n    if: needs.detect.outputs.deploy == 'true' && needs.config.outputs.configured == 'true'\n", "    needs: [detect, config, test]\n    if: needs.detect.outputs.deploy == 'true'\n");
    expectError(file, unconfigured, /job 'build' needs config.*configured == 'true'/);
  });

  test(`${file}: ECC L1: nothing may sit between the re-check and fly deploy`, () => {
    const between = replaceOnce(text, '      # Record the live image (rollback target), then deploy.\n', '      - name: Something in between\n        run: echo hi\n      # Record the live image (rollback target), then deploy.\n');
    expectError(file, between, /immediately before the step with id deploy/);
  });
}

test('deploy.yml and deploy-dev.yml never share a concurrency group', () => {
  const [p, d] = ['deploy.yml', 'deploy-dev.yml'].map((f) => parse(real(f)));
  assert.equal(p.concurrency, undefined); // production: only the release job's group, behind the owner gate
  assert.equal(d.concurrency.group, 'deploy-dev-${{ github.sha }}');
  assert.notEqual(p.jobs.release.concurrency.group, d.jobs.release.concurrency.group);
});

test('no other workflow may use FLY_API_TOKEN or any of the four deploy environments', () => {
  const withToken = replaceOnce(ci, '      - name: forge build\n', '      - name: forge build\n        env:\n          T: ${{ secrets.FLY_API_TOKEN }}\n');
  expectError('ci.yml', withToken, /FLY_API_TOKEN/);
  for (const env of [...ALL_ENVS, 'Production', 'DEVELOPMENT']) {
    expectError('ci.yml', replaceOnce(ci, '  contracts:\n    name: contracts\n', `  contracts:\n    name: contracts\n    environment: ${env}\n`), /deploy workflows/);
  }
  expectError('ci.yml', replaceOnce(ci, '  contracts:\n    name: contracts\n', "  contracts:\n    name: contracts\n    environment: \"${{ 'production' }}\"\n"), /expression/);
  expectError('nightly.yml', real('deploy-dev.yml'), /deploy workflows/);
  expectError('nightly.yml', real('deploy.yml'), /deploy workflows/);
});

test('the privileged workflows may not use the Fly token or any environment either', () => {
  const am = real('auto-merge.yml');
  for (const env of ['production', 'development']) {
    expectError('auto-merge.yml', am.replace('    runs-on: ubuntu-24.04\n', `    environment: ${env}\n    runs-on: ubuntu-24.04\n`), /environment/);
  }
  expectError('auto-merge.yml', am.replace('      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n', '      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n      T: ${{ secrets.FLY_API_TOKEN }}\n'), /FLY_API_TOKEN/);
});

test('ci.yml: `full` forces every area job on; every area job checks out the caller\'s own commit (no `ref` input)', () => {
  const wf = parse(ci);
  assert.equal(wf.on.workflow_call.inputs.full.type, 'boolean');
  // production runs AT the tag, so its own commit is the tagged one; a ref input is not needed (ECC HIGH, CodeQL)
  assert.deepEqual(Object.keys(wf.on.workflow_call.inputs), ['full']);
  // deployments-onchain is the one deliberate exception: a network check (public RPCs) that runs only on PRs touching
  // contracts/deployments/**, so push and deploy CI never depend on a third-party RPC (deployments-check.yml re-checks
  // weekly). It must stay PR-only and path-filtered.
  assert.equal(String(wf.jobs['deployments-onchain'].if), "github.event_name == 'pull_request' && needs.changes.outputs.deployments == 'true'");
  assert.ok(wf.jobs['ci-ok'].needs.includes('deployments-onchain'));
  const forced = Object.entries(wf.jobs).filter(([id]) => !['changes', 'pr-checks', 'ci-ok', 'deployments-onchain'].includes(id));
  assert.ok(forced.length >= 7);
  for (const [id, job] of forced) {
    assert.match(String(job.if), /inputs\.full \|\|/, id);
    const checkouts = job.steps.filter((s) => String(s.uses).startsWith('actions/checkout@'));
    assert.ok(checkouts.length >= 1, id);
    for (const c of checkouts) assert.equal(c.with?.ref, undefined, id);
  }
  assert.match(String(wf.concurrency.group), /github\.workflow/);
});

test('zizmor: self-repository may be ignored once per deploy workflow, pinned to its reusable-CI line', () => {
  const base = 'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": hash-pin\n';
  const both = `${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n      - deploy-dev.yml:80\n`;
  const lines = { 'deploy.yml': 74, 'deploy-dev.yml': 80 };
  assert.deepEqual(checkZizmorConfig(both), []);
  assert.deepEqual(checkZizmorConfig(both, { selfRepositoryLines: lines }), []);
  assert.match(checkZizmorConfig(both, { selfRepositoryLines: { ...lines, 'deploy.yml': 12 } }).join(), /deploy\.yml:12/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n`, { selfRepositoryLines: lines }).join(), /deploy-dev\.yml:80/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n      - deploy.yml:75\n`).join(), /self-repository/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - ci.yml:74\n`).join(), /self-repository/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml\n`).join(), /self-repository/);
  const lineOf = (f) => real(f).split('\n').findIndex((l) => /^\s*uses: \.\/\.github\/workflows\/ci\.yml\b/.test(l)) + 1;
  const zizmor = readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8');
  assert.deepEqual(checkZizmorConfig(zizmor, { selfRepositoryLines: { 'deploy.yml': lineOf('deploy.yml'), 'deploy-dev.yml': lineOf('deploy-dev.yml') } }), []);
});
