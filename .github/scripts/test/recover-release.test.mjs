// OpenSpec change release-recovery-tool-assets, task 2.1: the publish job's asset check and checksum files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINARIES, prepare } from '../recover-release.mjs';

const WHEEL = 'cryoshield_recover-1.0.0-py3-none-any.whl';
const SDIST = 'cryoshield_recover-1.0.0.tar.gz';
const sha = (b) => createHash('sha256').update(b).digest('hex');

function staged(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'recover-assets-'));
  const files = { ...Object.fromEntries(BINARIES.map((b) => [b, `binary ${b}`])), [WHEEL]: 'wheel', [SDIST]: 'sdist', ...extra };
  for (const [name, body] of Object.entries(files)) if (body !== null) writeFileSync(join(dir, name), body);
  return dir;
}

test('the binary names are fixed and version-free', () => {
  assert.deepEqual(BINARIES, [
    'cryoshield-recover-linux-arm64',
    'cryoshield-recover-linux-x86_64',
    'cryoshield-recover-macos-arm64',
    'cryoshield-recover-macos-x86_64',
    'cryoshield-recover-windows-x86_64.exe',
  ]);
});

test('prepare writes a .sha256 per asset and a sorted SHA256SUMS from the bytes', () => {
  const dir = staged();
  const assets = prepare(dir);
  const expected = [...BINARIES, SDIST, WHEEL].sort();
  assert.deepEqual(assets, expected);
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  assert.equal(sums, expected.map((n) => `${sha(readFileSync(join(dir, n)))}  ${n}\n`).join(''));
  for (const n of expected) {
    assert.equal(readFileSync(join(dir, `${n}.sha256`), 'utf8'), `${sha(readFileSync(join(dir, n)))}  ${n}\n`);
  }
  assert.deepEqual(readdirSync(dir).sort(), [...expected, ...expected.map((n) => `${n}.sha256`), 'SHA256SUMS'].sort());
});

test('a missing binary, wheel or sdist is refused', () => {
  assert.throws(() => prepare(staged({ 'cryoshield-recover-macos-x86_64': null })), /missing: cryoshield-recover-macos-x86_64/);
  assert.throws(() => prepare(staged({ [WHEEL]: null })), /exactly one wheel/);
  assert.throws(() => prepare(staged({ [SDIST]: null })), /exactly one source archive/);
});

test('an extra or oddly named file is refused', () => {
  assert.throws(() => prepare(staged({ 'cryoshield-recover-linux-riscv64': 'x' })), /unexpected file: cryoshield-recover-linux-riscv64/);
  assert.throws(() => prepare(staged({ 'cryoshield_recover-0.2.0-py3-none-any.whl': 'w2' })), /exactly one wheel/);
  assert.throws(() => prepare(staged({ 'notes.txt': 'x' })), /unexpected file: notes\.txt/);
});

test('wheel and sdist must carry the same version', () => {
  const dir = staged({ [SDIST]: null, 'cryoshield_recover-0.2.0.tar.gz': 's' });
  assert.throws(() => prepare(dir), /version/);
});

test('on a release, the tool version must equal the tag (design D8)', () => {
  assert.deepEqual(prepare(staged(), { tag: 'v1.0.0' }).length, 7);
  assert.throws(() => prepare(staged(), { tag: 'v1.0.1' }), /tool version 1\.0\.0 does not match the release tag v1\.0\.1/);
  assert.throws(() => prepare(staged(), { tag: '1.0.0' }), /tag must look like v1\.2\.3/);
  assert.throws(() => prepare(staged(), { tag: 'v1.0.0;rm' }), /tag must look like v1\.2\.3/);
});

test('an empty file, a directory or a symlink is refused', () => {
  assert.throws(() => prepare(staged({ 'cryoshield-recover-linux-x86_64': '' })), /empty: cryoshield-recover-linux-x86_64/);
  const d = staged({ 'cryoshield-recover-linux-arm64': null });
  mkdirSync(join(d, 'cryoshield-recover-linux-arm64'));
  assert.throws(() => prepare(d), /not a regular file: cryoshield-recover-linux-arm64/);
  const s = staged({ 'cryoshield-recover-macos-arm64': null });
  symlinkSync(join(s, WHEEL), join(s, 'cryoshield-recover-macos-arm64'));
  assert.throws(() => prepare(s), /not a regular file: cryoshield-recover-macos-arm64/);
});

test('pre-existing checksum files are refused (they are written here, from the bytes)', () => {
  assert.throws(() => prepare(staged({ 'cryoshield-recover-linux-x86_64.sha256': 'x' })), /unexpected file/);
  assert.throws(() => prepare(staged({ SHA256SUMS: 'x' })), /unexpected file: SHA256SUMS/);
});

test('CLI: exit 0 and the asset list on success, exit 1 with an error otherwise', () => {
  const script = fileURLToPath(new URL('../recover-release.mjs', import.meta.url));
  const ok = spawnSync(process.execPath, [script, staged()], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /cryoshield-recover-windows-x86_64\.exe/);
  const tagged = spawnSync(process.execPath, [script, staged(), '--tag', 'v1.0.0'], { encoding: 'utf8' });
  assert.equal(tagged.status, 0, tagged.stderr);
  const mismatch = spawnSync(process.execPath, [script, staged(), '--tag', 'v2.0.0'], { encoding: 'utf8' });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /does not match the release tag v2\.0\.0/);
  const bad = spawnSync(process.execPath, [script, staged({ 'x.txt': 'x' })], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /::error title=recovery tool assets::unexpected file: x\.txt/);
  const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});
