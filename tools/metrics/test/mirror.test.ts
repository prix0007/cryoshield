// Task 2.1: mirror coverage counts a vault only when an Arweave item tagged with its vaultId AND latest version has
// data whose keccak256 equals the on-chain blobHash (spec "Missing mirror", "Wrong bytes do not count").
import { keccak256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { collect } from '../src/metrics.ts';
import { mirrorCoverage, type MirrorTarget } from '../src/mirror.ts';
import { network, RPC, scenario, VAULT } from './fixtures/scenario.ts';
import { fixtureBlob } from './fixtures/blobs.ts';

const GW = 'https://gateway.example';

interface Item {
  id: string;
  vaultId: string;
  version: number;
  data: Uint8Array;
  appName?: string;
  size?: number;
}

/** A GraphQL + data gateway over `items`, honouring the tag filter like arweave.net does. */
function gateway(items: Item[], opts: { failGraphql?: boolean; ignoreFilter?: boolean } = {}) {
  const seen: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    if (url === `${GW}/graphql`) {
      if (opts.failGraphql) return new Response('down', { status: 502 });
      const { variables } = JSON.parse(String(init?.body)) as { variables: { tags: { name: string; values: string[] }[] } };
      const want = (n: string) => variables.tags.find((t) => t.name === n)?.values[0];
      const hits = items.filter(
        (i) => opts.ignoreFilter || (i.vaultId === want('CryoShield-Vault-Id') && String(i.version) === want('CryoShield-Version')),
      );
      return Response.json({
        data: {
          transactions: {
            edges: hits.map((i) => ({
              node: {
                id: i.id,
                data: { size: String(i.size ?? i.data.length) },
                tags: [
                  { name: 'App-Name', value: i.appName ?? 'CryoShield' },
                  { name: 'CryoShield-Vault-Id', value: i.vaultId },
                  { name: 'CryoShield-Version', value: String(i.version) },
                ],
              },
            })),
          },
        },
      });
    }
    const item = items.find((i) => url === `${GW}/${i.id}`);
    return item ? new Response(item.data) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, seen };
}

const blobA = fixtureBlob(2, { seed: 1 });
const blobB = fixtureBlob(2, { seed: 2 });
const blobC = fixtureBlob(3, { seed: 3 });
const targets: MirrorTarget[] = [
  { vaultId: VAULT.a, version: 1, blobHash: keccak256(blobA) },
  { vaultId: VAULT.b, version: 1, blobHash: keccak256(blobB) },
  { vaultId: VAULT.c, version: 3, blobHash: keccak256(blobC) },
];
const id = (n: number) => `item${String(n).padStart(39, '0')}`;

describe('mirror coverage', () => {
  it('missing mirror: 2 of 3', async () => {
    const g = gateway([
      { id: id(1), vaultId: VAULT.a, version: 1, data: blobA },
      { id: id(2), vaultId: VAULT.b, version: 1, data: blobB },
    ]);
    expect(await mirrorCoverage(targets, [GW], g.fetchFn)).toEqual({ vaults: 3, mirrored: 2, not_mirrored: 1, lookup_failed: 0 });
  });

  it('wrong bytes do not count, even with matching tags', async () => {
    const wrong = blobC.slice();
    wrong[wrong.length - 1] = (wrong.at(-1) ?? 0) ^ 1;
    const g = gateway([{ id: id(3), vaultId: VAULT.c, version: 3, data: wrong }]);
    expect((await mirrorCoverage([targets[2] as MirrorTarget], [GW], g.fetchFn)).mirrored).toBe(0);
  });

  it('an older version, another vault or another app does not count (tags re-checked client-side)', async () => {
    const g = gateway(
      [
        { id: id(4), vaultId: VAULT.c, version: 2, data: blobC },
        { id: id(5), vaultId: VAULT.a, version: 3, data: blobC },
        { id: id(6), vaultId: VAULT.c, version: 3, data: blobC, appName: 'Other' },
      ],
      { ignoreFilter: true },
    );
    expect((await mirrorCoverage([targets[2] as MirrorTarget], [GW], g.fetchFn)).mirrored).toBe(0);
  });

  it('never downloads more than 1024 bytes of an item', async () => {
    const big = new Uint8Array(4096);
    const g = gateway([{ id: id(7), vaultId: VAULT.c, version: 3, data: big, size: 1000 }]);
    const r = await mirrorCoverage([{ vaultId: VAULT.c, version: 3, blobHash: keccak256(big) as Hex }], [GW], g.fetchFn);
    expect(r.mirrored).toBe(0);
    const g2 = gateway([{ id: id(8), vaultId: VAULT.c, version: 3, data: big }]);
    await mirrorCoverage([{ vaultId: VAULT.c, version: 3, blobHash: keccak256(big) as Hex }], [GW], g2.fetchFn);
    expect(g2.seen).not.toContain(`${GW}/${id(8)}`); // listed size > 1024: never fetched
  });

  it('a failed lookup is counted separately, not as mirrored, and the run still succeeds', async () => {
    const g = gateway([], { failGraphql: true });
    expect(await mirrorCoverage(targets, [GW], g.fetchFn)).toEqual({ vaults: 3, mirrored: 0, not_mirrored: 0, lookup_failed: 3 });
  });

  it('the full run reports coverage for the latest version of every vault', async () => {
    const { chain, blobs } = scenario();
    const g = gateway([
      { id: id(1), vaultId: VAULT.a, version: 1, data: blobs.a },
      { id: id(2), vaultId: VAULT.c, version: 3, data: blobs.c },
    ]);
    const chainFetch = chain.fetchFor([RPC]);
    const fetchFn = ((u: string | URL | Request, i?: RequestInit) => (String(u) === RPC ? chainFetch(u, i) : g.fetchFn(u, i))) as typeof fetch;
    const r = await collect(network(), { fetchFn, mirror: { gateways: [GW] }, gas: false });
    expect(r.mirror_coverage).toEqual({ vaults: 3, mirrored: 2, not_mirrored: 1, lookup_failed: 0 });
    // every request went to the preset RPC or the configured gateway (spec "Runs with no credentials")
    for (const u of g.seen) expect(u.startsWith(`${GW}/`)).toBe(true);
  });
});
