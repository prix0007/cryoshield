// The aggregate report (spec product-metrics "Aggregate metrics report", "No identifiers in the report"; design D2).
// Pure functions: events and per-vault facts in, counts out. No address, vaultId, locator, tx hash or blob byte ever
// reaches the report, and assertNoIdentifiers() refuses one with any 20/32-byte hex value other than the registries.
//
// Small cells on public networks (every chain except the local one) are never published, and never recoverable by
// subtraction, within one report or across successive weekly reports:
// - Time series (created, updates, weekly_active, sponsored gas) are merged CHRONOLOGICALLY: consecutive weeks are
//   joined into one range ("2026-W40..2026-W42") until it covers at least MIN_CELL vaults (gas: accounts). A range
//   depends only on data up to its own last week, so a published range never changes in a later report. The open
//   trailing range is only "pending": "<3", and no total includes it.
// - The run stops at the last complete ISO week (metrics.ts), so a week's data never changes after it is published.
// - Snapshot metrics (vaults_total, vaults_by_registry, keys_per_vault, mirror_coverage) cover only the "published
//   population": vaults created in closed creation ranges, which grows in steps of at least MIN_CELL vaults. Their
//   categories are merged ("2-3" keys, "v1+v2") until each holds at least MIN_CELL vaults; no cell is hidden.
import { formatEther } from 'viem';

export const SCHEMA = 'cryoshield-metrics/1';
export const MIN_CELL = 3;
export const SUPPRESSED = `<${MIN_CELL}` as const;
export type Cell = number | typeof SUPPRESSED;

/** ISO-8601 week of a UNIX timestamp (UTC), e.g. "2026-W41". */
export function isoWeek(ts: number): string {
  const d = new Date(ts * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  // the Thursday of week 1 always falls on January 1..7
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / 604_800_000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** UNIX time of the Monday 00:00 UTC that starts the ISO week containing `ts`. */
export function weekStart(ts: number): number {
  const d = new Date(ts * 1000);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) / 1000;
}

const HEX_RUN = /(?:0x)?[0-9a-fA-F]{40,}/g;

/** Every hex run of 40+ digits (20-byte addresses, 32-byte ids and hashes, with or without 0x) not in `allowed`. */
export function findIdentifiers(text: string, allowed: string[]): string[] {
  const ok = new Set(allowed.map((a) => a.toLowerCase()));
  return [...text.matchAll(HEX_RUN)].map((m) => m[0]).filter((h) => !ok.has(h.toLowerCase()));
}

export function assertNoIdentifiers(report: { registries: readonly { address: string }[] }): void {
  const found = findIdentifiers(JSON.stringify(report), report.registries.map((r) => r.address));
  if (found.length > 0) throw new Error(`refusing to write a report containing ${found.length} identifier(s)`);
}

// ---------------------------------------------------------------------------------------------------------------
// Merging

export interface Bucket<V> {
  value: V;
  members: Set<string>; // vaults (or accounts) in the bucket; only its size is ever used
}

export interface Merged<V> {
  cells: Record<string, V>;
  /** "<3" when the open trailing range covers 1..MIN_CELL-1 members, else 0. */
  pending: Cell;
  /** Keys (weeks) inside closed ranges. */
  closed: Set<string>;
  /** The closed ranges, oldest first. */
  ranges: { label: string; weeks: string[]; members: Set<string> }[];
}

/**
 * Join consecutive weeks (sorted keys) into ranges until each covers at least MIN_CELL distinct members. With
 * `applied` false (local chain) every week is its own cell. `add` combines two bucket values.
 */
export function mergeSeries<V>(byWeek: Map<string, Bucket<V>>, add: (a: V, b: V) => V, applied: boolean): Merged<V> {
  const weeks = [...byWeek.keys()].sort();
  const cells: Record<string, V> = {};
  const closed = new Set<string>();
  const ranges: Merged<V>['ranges'] = [];
  type Open = { first: string; last: string; value: V; members: Set<string>; weeks: string[] };
  let open: Open | null = null;
  for (const w of weeks) {
    const b = byWeek.get(w) as Bucket<V>;
    const cur: Open = open
      ? { first: open.first, last: w, value: add(open.value, b.value), members: new Set([...open.members, ...b.members]), weeks: [...open.weeks, w] }
      : { first: w, last: w, value: b.value, members: new Set(b.members), weeks: [w] };
    if (!applied || cur.members.size >= MIN_CELL) {
      const label = cur.first === cur.last ? cur.first : `${cur.first}..${cur.last}`;
      cells[label] = cur.value;
      ranges.push({ label, weeks: cur.weeks, members: cur.members });
      for (const x of cur.weeks) closed.add(x);
      open = null;
    } else open = cur;
  }
  const rest = open as Open | null;
  return { cells, pending: rest && rest.members.size > 0 ? SUPPRESSED : 0, closed, ranges };
}

/**
 * Merge ordered categories (e.g. key counts 2..8) into adjacent groups of at least MIN_CELL members; a short
 * remainder joins the last group. `population` must be 0 or at least MIN_CELL when `applied`.
 */
export function mergeCategories(ordered: [string, number][], applied: boolean, join: (a: string, b: string) => string): Record<string, number> {
  const out: [string, number][] = [];
  let acc: [string, string, number] | null = null; // first label, last label, count
  for (const [label, n] of ordered) {
    if (n === 0) continue;
    acc = acc ? [acc[0], label, acc[2] + n] : [label, label, n];
    if (!applied || acc[2] >= MIN_CELL) {
      out.push([acc[0] === acc[1] ? acc[0] : join(acc[0], acc[1]), acc[2]]);
      acc = null;
    }
  }
  if (acc) {
    const prev = out.pop();
    if (prev) {
      const first = prev[0].split(/\.\.|-|\+/)[0] ?? prev[0];
      out.push([join(first, acc[1]), prev[1] + acc[2]]);
    } else if (!applied) out.push([acc[0] === acc[1] ? acc[0] : join(acc[0], acc[1]), acc[2]]);
  }
  return Object.fromEntries(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs and the report

export type EventKind = 'created' | 'updated' | 'locator';

/** One registry event, reduced to what aggregation needs. `vault` is an opaque per-run key, never output. */
export interface VaultEvent {
  kind: EventKind;
  registry: number;
  vault: string;
  ts: number;
}

export interface VaultFacts {
  registry: number;
  keys: number | null;
}

export interface GasOp {
  sender: string; // never output
  sponsored: boolean;
  otherPaymaster: boolean;
  wei: bigint;
  ts: number;
}

export type MirrorOutcome = 'mirrored' | 'not_mirrored' | 'lookup_failed';

export interface MirrorResult {
  vaults: number;
  mirrored: number;
  not_mirrored: number;
  lookup_failed: number;
}

/** Public form: when 1..2 vaults are not (known to be) mirrored, only bounds are shown. */
export interface MirrorReport {
  vaults: number;
  mirrored: number | string;
  not_mirrored: number | string;
  lookup_failed: number | string;
}

export interface WeekGas {
  ops: number;
  wei: string;
  eth: string;
}

export interface SponsoredGas {
  ops: number;
  total_wei: string;
  total_eth: string;
  per_week: Record<string, WeekGas>;
  pending: Cell;
  excluded: { unsponsored_ops: Cell; other_paymaster_ops: Cell };
  paymasters_configured: number;
}

/** A closed creation range ("cohort") and its snapshot, frozen at the cohort's last block on public networks. */
export interface Cohort {
  weeks: string;
  vaults: number;
  vaults_by_registry: Record<string, number>;
  keys_per_vault: Record<string, number>;
  /** Public networks: items mirrored within MIRROR_WINDOW_DAYS of the cohort's close; "pending" until measurable. */
  mirror_coverage: MirrorReport | 'pending' | null;
}

/** A vault's snapshot as of its cohort's close (public networks). */
export interface FrozenFacts {
  keys: number | null;
  mirror: MirrorOutcome | 'pending' | null;
}

export const MIRROR_WINDOW_DAYS = 28;

export interface Report {
  schema: typeof SCHEMA;
  generated_at: string;
  network: string;
  chain_id: number;
  registries: { version: string; address: string; from_block: number; to_block: number }[];
  /** On public networks: the last complete ISO week read. */
  through_week: string | null;
  suppression: { min_cell: number; applied: boolean };
  vaults_total: number;
  vaults_pending: Cell;
  vaults_by_registry: Record<string, number> | null;
  created: Record<string, number>;
  updates_total: number;
  updates: Record<string, number>;
  updates_pending: Cell;
  weekly_active: Record<string, number>;
  weekly_active_pending: Cell;
  /** Local chain only (exact, latest state); null on public networks, where `cohorts` carries the snapshots. */
  keys_per_vault: Record<string, number> | null;
  mirror_coverage: MirrorReport | null;
  cohorts: Cohort[];
  sponsored_gas: SponsoredGas | null;
  notes: string[];
}

export interface ReportInput {
  network: string;
  chainId: number;
  public: boolean;
  registries: { version: number; address: string; fromBlock: bigint; toBlock: bigint }[];
  throughWeek: string | null;
  events: VaultEvent[];
  vaults: Map<string, VaultFacts>;
  /** Per-vault mirror outcome (opaque vault keys), or null when not checked. Local chain. */
  mirror: Map<string, MirrorOutcome> | null;
  /** Per-vault snapshot at its cohort's close. Public networks. */
  frozen: Map<string, FrozenFacts> | null;
  gas: { ops: GasOp[]; paymasters: number } | null;
  notes: string[];
  now: Date;
}

const addN = (a: number, b: number) => a + b;

function series(events: VaultEvent[], kinds: EventKind[], count: 'events' | 'vaults'): Map<string, Bucket<number>> {
  const byWeek = new Map<string, Bucket<number> & { events: number }>();
  for (const e of events) {
    if (!kinds.includes(e.kind)) continue;
    const w = isoWeek(e.ts);
    const b = byWeek.get(w) ?? { value: 0, events: 0, members: new Set<string>() };
    b.events++;
    b.members.add(e.vault);
    b.value = count === 'events' ? b.events : b.members.size;
    byWeek.set(w, b);
  }
  return byWeek;
}

/** Distinct vaults across a range (not the sum of weekly counts): merge members, then count. */
function activeSeries(events: VaultEvent[], applied: boolean): Merged<number> {
  const byWeek = new Map<string, Bucket<Set<string>>>();
  for (const e of events) {
    const w = isoWeek(e.ts);
    const b = byWeek.get(w) ?? { value: new Set<string>(), members: new Set<string>() };
    b.value.add(e.vault);
    b.members.add(e.vault);
    byWeek.set(w, b);
  }
  const m = mergeSeries(byWeek, (a, b) => new Set([...a, ...b]), applied);
  return { cells: Object.fromEntries(Object.entries(m.cells).map(([k, v]) => [k, v.size])), pending: m.pending, closed: m.closed, ranges: m.ranges };
}

/** The closed creation ranges ("cohorts") and their vaults; a cohort never changes once closed. */
export function creationCohorts(events: VaultEvent[], applied: boolean): Merged<number>['ranges'] {
  return mergeSeries(series(events, ['created'], 'vaults'), addN, applied).ranges;
}

const eth = (wei: bigint) => formatEther(wei);

function sponsoredGas(gas: { ops: GasOp[]; paymasters: number }, applied: boolean): SponsoredGas {
  const byWeek = new Map<string, Bucket<{ ops: number; wei: bigint }>>();
  for (const o of gas.ops.filter((x) => x.sponsored)) {
    const w = isoWeek(o.ts);
    const b = byWeek.get(w) ?? { value: { ops: 0, wei: 0n }, members: new Set<string>() };
    b.value = { ops: b.value.ops + 1, wei: b.value.wei + o.wei };
    b.members.add(o.sender);
    byWeek.set(w, b);
  }
  // per-week gas sums are merged until each covers MIN_CELL distinct accounts, so no published sum (or difference of
  // published sums across reports) is the cost of one account's operations
  const m = mergeSeries(byWeek, (a, b) => ({ ops: a.ops + b.ops, wei: a.wei + b.wei }), applied);
  let ops = 0;
  let total = 0n;
  const per_week: Record<string, WeekGas> = {};
  for (const [k, v] of Object.entries(m.cells)) {
    per_week[k] = { ops: v.ops, wei: v.wei.toString(), eth: eth(v.wei) };
    ops += v.ops;
    total += v.wei;
  }
  // excluded operations: counts only (no wei), over the same closed weeks, hidden below MIN_CELL accounts
  const inClosed = (o: GasOp) => !applied || m.closed.has(isoWeek(o.ts));
  const count = (pick: (o: GasOp) => boolean): Cell => {
    const sel = gas.ops.filter((o) => pick(o) && inClosed(o));
    const accounts = new Set(sel.map((o) => o.sender)).size;
    return applied && accounts > 0 && accounts < MIN_CELL ? SUPPRESSED : sel.length;
  };
  return {
    ops,
    total_wei: total.toString(),
    total_eth: eth(total),
    per_week,
    pending: m.pending,
    excluded: {
      unsponsored_ops: count((o) => !o.sponsored && !o.otherPaymaster),
      other_paymaster_ops: count((o) => o.otherPaymaster),
    },
    paymasters_configured: gas.paymasters,
  };
}

export function mirrorReport(outcomes: MirrorOutcome[], applied: boolean): MirrorReport {
  const n = (o: MirrorOutcome) => outcomes.filter((x) => x === o).length;
  const vaults = outcomes.length;
  const mirrored = n('mirrored');
  const nm = n('not_mirrored');
  const lf = n('lookup_failed');
  const small = (x: number) => applied && x > 0 && x < MIN_CELL;
  const bound = (x: number) => `>=${Math.max(0, x - (MIN_CELL - 1))}`;
  if (small(vaults - mirrored)) {
    // 1..2 vaults not (known to be) mirrored: show only bounds, never how many or of which kind
    return { vaults, mirrored: bound(vaults), not_mirrored: SUPPRESSED, lookup_failed: SUPPRESSED };
  }
  // one small part next to a large one: hide the small one, show the large one as a bound so that
  // vaults - mirrored - shown cannot recover it
  if (small(nm)) return { vaults, mirrored, not_mirrored: SUPPRESSED, lookup_failed: bound(lf + nm) };
  if (small(lf)) return { vaults, mirrored, not_mirrored: bound(nm + lf), lookup_failed: SUPPRESSED };
  return { vaults, mirrored, not_mirrored: nm, lookup_failed: lf };
}

export function buildReport(input: ReportInput): Report {
  const applied = input.public;
  const created = mergeSeries(series(input.events, ['created'], 'vaults'), addN, applied);
  const updates = mergeSeries(series(input.events, ['updated'], 'events'), addN, applied);
  const active = activeSeries(input.events, applied);

  // Snapshots per closed creation cohort. On public networks each cohort's values are frozen at its close (key
  // counts at its last block, mirror status within MIRROR_WINDOW_DAYS of it), so a cohort never changes once
  // published and two reports differ only by whole new cohorts of at least MIN_CELL vaults.
  const snapshot = (members: string[], keyOf: (k: string) => number | null) => {
    const byRegistry = new Map<number, number>();
    const keys = new Map<string, number>();
    for (const k of members) {
      const f = input.vaults.get(k);
      if (!f) continue;
      byRegistry.set(f.registry, (byRegistry.get(f.registry) ?? 0) + 1);
      const n = keyOf(k);
      const label = n === null ? 'unknown' : String(n);
      keys.set(label, (keys.get(label) ?? 0) + 1);
    }
    const registries = [...byRegistry.entries()].sort(([x], [y]) => x - y).map(([v, c]) => [`v${v}`, c] as [string, number]);
    // key counts ascending, then "unknown" (an unreadable header) last; small groups merge with their neighbour
    const ordered = [...keys.entries()].sort(([x], [y]) => (x === 'unknown' ? 1 : y === 'unknown' ? -1 : Number(x) - Number(y)));
    return {
      vaults_by_registry: mergeCategories(registries, applied, (x, y) => `${x}+${y}`),
      keys_per_vault: mergeCategories(ordered, applied, (x, y) => `${x}-${y}`),
    };
  };
  const latestKeys = (k: string) => input.vaults.get(k)?.keys ?? null;
  const cohorts: Cohort[] = creationCohorts(input.events, applied).map((r) => {
    const members = [...r.members].filter((k) => input.vaults.has(k));
    let mirror: Cohort['mirror_coverage'] = null;
    if (applied && input.frozen) {
      const outcomes = members.map((k) => input.frozen?.get(k)?.mirror ?? null);
      if (outcomes.some((o) => o === 'pending')) mirror = 'pending';
      else if (outcomes.every((o) => o !== null)) mirror = mirrorReport(outcomes as MirrorOutcome[], true);
    } else if (!applied && input.mirror) {
      mirror = mirrorReport(members.map((k) => input.mirror?.get(k) ?? 'lookup_failed'), false);
    }
    const keyOf = applied ? (k: string) => input.frozen?.get(k)?.keys ?? null : latestKeys;
    return { weeks: r.label, vaults: members.length, ...snapshot(members, keyOf), mirror_coverage: mirror };
  });
  const all = [...input.vaults.keys()];
  const local = applied ? null : snapshot(all, latestKeys);
  const mirror = !applied && input.mirror ? mirrorReport(all.map((k) => input.mirror?.get(k) ?? 'lookup_failed'), false) : null;
  const vaultsTotal = applied ? cohorts.reduce((n, c) => n + c.vaults, 0) : all.length;

  const sum = (r: Record<string, number>) => Object.values(r).reduce(addN, 0);
  const report: Report = {
    schema: SCHEMA,
    generated_at: input.now.toISOString(),
    network: input.network,
    chain_id: input.chainId,
    registries: input.registries.map((r) => ({
      version: `v${r.version}`,
      address: r.address.toLowerCase(),
      from_block: Number(r.fromBlock),
      to_block: Number(r.toBlock),
    })),
    through_week: input.throughWeek,
    suppression: { min_cell: MIN_CELL, applied },
    vaults_total: vaultsTotal,
    vaults_pending: created.pending,
    vaults_by_registry: local?.vaults_by_registry ?? null,
    created: created.cells,
    updates_total: sum(updates.cells),
    updates: updates.cells,
    updates_pending: updates.pending,
    weekly_active: active.cells,
    weekly_active_pending: active.pending,
    keys_per_vault: local?.keys_per_vault ?? null,
    mirror_coverage: mirror,
    cohorts,
    sponsored_gas: input.gas ? sponsoredGas(input.gas, applied) : null,
    notes: input.notes,
  };
  assertNoIdentifiers(report);
  return report;
}
