#!/usr/bin/env node
// Recovery tool release assets (OpenSpec change release-recovery-tool-assets, design D2/D3). Run by recover-release.yml
// on the downloaded build outputs, before attestation and upload (or, for the owner's dry run, before the artifact
// upload). It trusts no hash from a build job: it checks the exact file set and computes every checksum from the bytes.
//
//   node recover-release.mjs <dir> [--tag vX.Y.Z]   exit 0 (prints the asset names), 1 refused, 2 usage
//
// Writes <file>.sha256 ("<hex>  <file>", the `shasum -a 256 -c` format) for every asset and a sorted SHA256SUMS.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Version-free, so https://github.com/<repo>/releases/latest/download/<name> never changes (design D2).
export const BINARIES = [
  'cryoshield-recover-linux-arm64',
  'cryoshield-recover-linux-x86_64',
  'cryoshield-recover-macos-arm64',
  'cryoshield-recover-macos-x86_64',
  'cryoshield-recover-windows-x86_64.exe',
];
// Standard names: pip and pipx refuse a wheel whose file name is not name-version-tags.whl.
const WHEEL = /^cryoshield_recover-(\d+\.\d+\.\d+(?:[a-z0-9.+-]*)?)-py3-none-any\.whl$/;
const SDIST = /^cryoshield_recover-(\d+\.\d+\.\d+(?:[a-z0-9.+-]*)?)\.tar\.gz$/;

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// On a release, `tag` is the run's v* tag: the tool version (in the wheel name) must equal it (design D8), so
// `cryoshield-recover --version` names the release the files came from. The owner's dry run passes no tag.
export function prepare(dir, { tag } = {}) {
  if (tag !== undefined && !/^v\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(tag)) throw new Error('the tag must look like v1.2.3');
  const names = readdirSync(dir).sort();
  const wheels = names.filter((n) => WHEEL.test(n));
  const sdists = names.filter((n) => SDIST.test(n));
  for (const n of names) {
    if (!BINARIES.includes(n) && !WHEEL.test(n) && !SDIST.test(n)) throw new Error(`unexpected file: ${n}`);
  }
  const missing = BINARIES.filter((b) => !names.includes(b));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  if (wheels.length !== 1) throw new Error(`expected exactly one wheel, found ${wheels.length}`);
  if (sdists.length !== 1) throw new Error(`expected exactly one source archive, found ${sdists.length}`);
  const wv = WHEEL.exec(wheels[0])[1];
  const sv = SDIST.exec(sdists[0])[1];
  if (wv !== sv) throw new Error(`wheel version ${wv} and source archive version ${sv} differ`);
  if (tag !== undefined && `v${wv}` !== tag) {
    throw new Error(`tool version ${wv} does not match the release tag ${tag}; bump tools/recover (pyproject.toml, __init__.py, uv.lock) before tagging`);
  }

  const assets = [...BINARIES, wheels[0], sdists[0]].sort();
  const lines = [];
  for (const n of assets) {
    const st = lstatSync(join(dir, n));
    if (!st.isFile()) throw new Error(`not a regular file: ${n}`);
    if (st.size === 0) throw new Error(`empty: ${n}`);
    lines.push(`${sha256(join(dir, n))}  ${n}\n`);
  }
  assets.forEach((n, i) => writeFileSync(join(dir, `${n}.sha256`), lines[i]));
  writeFileSync(join(dir, 'SHA256SUMS'), lines.join(''));
  return assets;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, flag, tag, ...rest] = process.argv.slice(2);
  if (!dir || rest.length || (flag !== undefined && (flag !== '--tag' || !tag))) {
    console.error('usage: node recover-release.mjs <dir> [--tag vX.Y.Z]');
    process.exit(2);
  }
  try {
    for (const n of prepare(dir, flag ? { tag } : {})) console.log(n);
  } catch (e) {
    console.error(`::error title=recovery tool assets::${e.message}`);
    process.exit(1);
  }
}
