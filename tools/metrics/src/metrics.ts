// Orchestration (tasks 1.2-1.5, 2.1): read every registry's VaultCreated / VaultUpdated / LocatorAdded logs, the
// latest blob of every vault (for its key count N), Arweave mirror coverage and EntryPoint sponsored gas, and reduce
// them to the aggregate report. Reads only the network's preset RPCs and the configured Arweave gateways.
import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, hexToBytes, type Hex } from 'viem';
import { MAX_BATCH_IDS, REGISTRY_ABI, TOPIC } from './abi.ts';
import { keyCount } from './blob.ts';
import type { GasConfig, Network, RegistrySpec } from './config.ts';
import { DEFAULT_GATEWAYS, mirrorOutcomes, type MirrorTarget } from './mirror.ts';
import {
  buildReport,
  creationCohorts,
  isoWeek,
  MIRROR_WINDOW_DAYS,
  weekStart,
  type FrozenFacts,
  type GasOp,
  type MirrorOutcome,
  type Report,
  type VaultEvent,
  type VaultFacts,
} from './report.ts';
import { Rpc } from './rpc.ts';

export interface CollectOptions {
  fetchFn?: typeof fetch;
  /** false: skip; otherwise the gateways to check (default DEFAULT_GATEWAYS). */
  mirror?: false | { gateways?: string[] };
  /** false: skip; otherwise the EntryPoint and sponsor paymasters. */
  gas?: false | GasConfig;
  toBlock?: bigint;
  now?: Date;
  log?: (msg: string) => void;
}

interface Latest {
  key: string;
  registry: RegistrySpec;
  vaultId: Hex;
  owner: Hex | null;
  version: number;
  blobHash: Hex;
  /** Every VaultCreated/VaultUpdated of the vault: (block, version, blobHash). */
  history: { block: bigint; version: number; blobHash: Hex }[];
}

const SENDER_CHUNK = 50;
const word = (t: Hex | undefined): Hex => {
  if (!t || !/^0x[0-9a-f]{64}$/.test(t)) throw new Error('malformed log topic');
  return t;
};
const topicAddress = (t: Hex | undefined): Hex => `0x${word(t).slice(26)}` as Hex;
const addressTopic = (a: Hex): Hex => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}` as Hex;

async function readRegistry(rpc: Rpc, reg: RegistrySpec, toBlock: bigint) {
  const logs = await rpc.getLogs(
    { address: reg.address, topics: [[TOPIC.VaultCreated, TOPIC.VaultUpdated, TOPIC.LocatorAdded]] },
    reg.deployBlock,
    toBlock,
  );
  const events: (Omit<VaultEvent, 'ts'> & { block: bigint })[] = [];
  const latest = new Map<string, Latest>();
  for (const l of logs) {
    if (l.address !== reg.address) continue;
    const vaultId = word(l.topics[1]);
    const vault = `${reg.version}:${vaultId}`;
    if (l.topics[0] === TOPIC.LocatorAdded) {
      events.push({ kind: 'locator', registry: reg.version, vault, block: l.blockNumber });
      continue;
    }
    const created = l.topics[0] === TOPIC.VaultCreated;
    if (!created && l.topics[0] !== TOPIC.VaultUpdated) continue;
    const [version, blobHash] = decodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], l.data);
    events.push({ kind: created ? 'created' : 'updated', registry: reg.version, vault, block: l.blockNumber });
    const prev = latest.get(vault);
    const entry = { block: l.blockNumber, version, blobHash: blobHash.toLowerCase() as Hex };
    if (!prev || version >= prev.version) {
      latest.set(vault, {
        key: vault,
        registry: reg,
        vaultId,
        owner: created ? topicAddress(l.topics[2]) : (prev?.owner ?? null),
        version,
        blobHash: entry.blobHash,
        history: [...(prev?.history ?? []), entry],
      });
    } else {
      prev.history.push(entry);
      if (created) prev.owner = topicAddress(l.topics[2]);
    }
  }
  return { events, latest };
}

/** The key count N of each vault's blob as of `toBlock` (getVaults in batches on the v2 read ABI). */
async function keyCounts(rpc: Rpc, reg: RegistrySpec, ids: Hex[], toBlock: bigint): Promise<Map<Hex, number | null>> {
  const out = new Map<Hex, number | null>();
  if (reg.abi === 2) {
    for (let i = 0; i < ids.length; i += MAX_BATCH_IDS) {
      const batch = ids.slice(i, i + MAX_BATCH_IDS);
      const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'getVaults', args: [batch] });
      const res = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getVaults', data: await rpc.call(reg.address, data, toBlock) });
      batch.forEach((id, j) => out.set(id, keyCount(hexToBytes(res[j]?.blob ?? '0x'))));
    }
  } else {
    for (const id of ids) {
      const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'getVault', args: [id] });
      const [, blob] = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getVault', data: await rpc.call(reg.address, data, toBlock) });
      out.set(id, keyCount(hexToBytes(blob)));
    }
  }
  return out;
}

async function sponsoredOps(rpc: Rpc, gas: GasConfig, owners: Hex[], fromBlock: bigint, toBlock: bigint): Promise<GasOp[]> {
  const sponsors = new Set(gas.paymasters.map((p) => p.toLowerCase()));
  const ops: GasOp[] = [];
  const unique = [...new Set(owners.map((o) => o.toLowerCase() as Hex))].sort();
  for (let i = 0; i < unique.length; i += SENDER_CHUNK) {
    const senders = unique.slice(i, i + SENDER_CHUNK).map(addressTopic);
    const logs = await rpc.getLogs({ address: gas.entryPoint, topics: [TOPIC.UserOperationEvent, null, senders] }, fromBlock, toBlock);
    for (const l of logs) {
      if (l.address !== gas.entryPoint.toLowerCase() || l.topics[0] !== TOPIC.UserOperationEvent) continue;
      const paymaster = topicAddress(l.topics[3]);
      const [, , actualGasCost] = decodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], l.data);
      const zero = /^0x0{40}$/.test(paymaster);
      ops.push({
        sender: topicAddress(l.topics[2]),
        sponsored: sponsors.has(paymaster),
        otherPaymaster: !zero && !sponsors.has(paymaster),
        wei: actualGasCost,
        ts: await rpc.blockTimestamp(l.blockNumber),
      });
    }
  }
  return ops;
}

/** The last block whose timestamp is before `boundary` (binary search), or -1n. */
async function lastBlockBefore(rpc: Rpc, boundary: number, hi: bigint): Promise<bigint> {
  if ((await rpc.blockTimestamp(0n)) >= boundary) return -1n;
  let lo = 0n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if ((await rpc.blockTimestamp(mid)) < boundary) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export async function collect(net: Network, opts: CollectOptions = {}): Promise<Report> {
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? (() => {});
  const rpc = await Rpc.connect(net.rpcs, net.chainId, fetchFn); // chain-ID check BEFORE any log is read
  for (const w of rpc.warnings) log(w);
  const head = await rpc.blockNumber();
  let toBlock = opts.toBlock !== undefined && opts.toBlock < head ? opts.toBlock : head;
  const notes: string[] = [];
  let throughWeek: string | null = null;
  if (net.public) {
    // stop at the last COMPLETE ISO week, so a published week never changes in a later report (design D2)
    const boundary = weekStart(await rpc.blockTimestamp(toBlock));
    throughWeek = isoWeek(boundary - 1);
    toBlock = await lastBlockBefore(rpc, boundary, toBlock);
    log(`reading complete weeks only: through ${throughWeek} (block ${toBlock})`);
  }

  const events: VaultEvent[] = [];
  const vaults = new Map<string, VaultFacts>();
  const latestAll: Latest[] = [];
  const ranges: { version: number; address: string; fromBlock: bigint; toBlock: bigint }[] = [];
  for (const reg of net.registries) {
    log(`reading registry v${reg.version} from block ${reg.deployBlock} to ${toBlock}`);
    ranges.push({ version: reg.version, address: reg.address, fromBlock: reg.deployBlock, toBlock: toBlock < 0n ? 0n : toBlock });
    if (reg.deployBlock > toBlock) continue;
    const r = await readRegistry(rpc, reg, toBlock);
    for (const e of r.events) events.push({ kind: e.kind, registry: e.registry, vault: e.vault, ts: await rpc.blockTimestamp(e.block) });
    // latest key counts are a local-chain metric; public networks read them per cohort, frozen at its close
    const counts = net.public ? new Map<Hex, number | null>() : await keyCounts(rpc, reg, [...r.latest.values()].map((l) => l.vaultId), toBlock);
    for (const [key, l] of r.latest) {
      vaults.set(key, { registry: reg.version, keys: counts.get(l.vaultId) ?? null });
      latestAll.push(l);
    }
  }

  let mirror: Map<string, MirrorOutcome> | null = null;
  let frozen: Map<string, FrozenFacts> | null = null;
  const gateways = opts.mirror === false ? null : (opts.mirror?.gateways ?? DEFAULT_GATEWAYS);
  if (!gateways) notes.push('mirror coverage not checked');
  if (net.public && toBlock >= 0n) {
    // Freeze each closed creation cohort at its close (design D2): key counts at the cohort's last block, and mirror
    // coverage of the version current then, counting only items mined within MIRROR_WINDOW_DAYS of the close.
    frozen = new Map();
    const reportEnd = weekStart(await rpc.blockTimestamp(toBlock)) + 7 * 86_400;
    const byKey = new Map(latestAll.map((l) => [l.key, l]));
    for (const cohort of creationCohorts(events, true)) {
      const last = cohort.weeks[cohort.weeks.length - 1] as string;
      const memberTs = events.find((e) => e.kind === 'created' && isoWeek(e.ts) === last)?.ts ?? 0;
      const closeTs = weekStart(memberTs) + 7 * 86_400;
      const closeBlock = await lastBlockBefore(rpc, closeTs, toBlock);
      const members = [...cohort.members].map((k) => byKey.get(k)).filter((l): l is Latest => l !== undefined);
      for (const reg of net.registries) {
        const mine = members.filter((m) => m.registry === reg);
        if (mine.length === 0) continue;
        const counts = await keyCounts(rpc, reg, mine.map((m) => m.vaultId), closeBlock);
        for (const m of mine) frozen.set(m.key, { keys: counts.get(m.vaultId) ?? null, mirror: gateways ? 'pending' : null });
      }
      const deadline = closeTs + MIRROR_WINDOW_DAYS * 86_400;
      if (gateways && deadline <= reportEnd) {
        const targets: MirrorTarget[] = members.map((m) => {
          const at = m.history.filter((h) => h.block <= closeBlock).sort((a, b) => b.version - a.version)[0] ?? m.history[0];
          return { vaultId: m.vaultId, version: at?.version ?? m.version, blobHash: at?.blobHash ?? m.blobHash, deadline };
        });
        log(`checking Arweave mirror coverage of cohort ${cohort.label}`);
        const outcomes = await mirrorOutcomes(targets, gateways, fetchFn);
        members.forEach((m, i) => frozen?.set(m.key, { keys: frozen?.get(m.key)?.keys ?? null, mirror: outcomes[i] as MirrorOutcome }));
      }
    }
  } else if (gateways) {
    log(`checking Arweave mirror coverage of ${latestAll.length} vault(s)`);
    const targets: MirrorTarget[] = latestAll.map((l) => ({ vaultId: l.vaultId, version: l.version, blobHash: l.blobHash }));
    const outcomes = await mirrorOutcomes(targets, gateways, fetchFn);
    mirror = new Map(latestAll.map((l, i) => [l.key, outcomes[i] as MirrorOutcome]));
  }

  let gas: { ops: GasOp[]; paymasters: number } | null = null;
  if (opts.gas && toBlock >= 0n) {
    const owners = latestAll.map((l) => l.owner).filter((o): o is Hex => o !== null);
    const from = net.registries.reduce((m, r) => (r.deployBlock < m ? r.deployBlock : m), toBlock);
    log(`reading EntryPoint operations of ${new Set(owners).size} vault owner(s)`);
    gas = { ops: await sponsoredOps(rpc, opts.gas, owners, from, toBlock), paymasters: opts.gas.paymasters.length };
  } else notes.push('sponsored gas not measured (no sponsor paymaster configured for this network)');

  return buildReport({
    network: net.name,
    chainId: net.chainId,
    public: net.public,
    registries: ranges,
    throughWeek,
    events,
    vaults,
    mirror,
    frozen,
    gas,
    notes,
    now: opts.now ?? new Date(),
  });
}
