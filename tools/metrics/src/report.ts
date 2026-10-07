// The aggregate report (spec product-metrics "Aggregate metrics report", "No identifiers in the report").
// Pure functions: events and per-vault facts in, counts out. No address, vaultId, locator, tx hash or blob byte ever
// reaches the report; on public networks every weekly or distribution bucket holding fewer than MIN_CELL vaults is
// shown as "<3" (design D2), and assertNoIdentifiers() refuses to emit a report with any 20/32-byte hex value other
// than the registry addresses.
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

/** `value` unless the bucket holds 1..MIN_CELL-1 vaults on a public network. */
export function suppress(value: number, vaults: number, applied: boolean): Cell {
  return applied && vaults > 0 && vaults < MIN_CELL ? SUPPRESSED : value;
}

/**
 * Complementary suppression: a family of cells that sums to a published total must not have exactly one hidden cell,
 * or total minus the shown cells gives it away. Then the smallest shown non-zero cell is hidden too.
 */
export function complement<T>(cells: Record<string, T | typeof SUPPRESSED>, sizes: Record<string, number>): Record<string, T | typeof SUPPRESSED> {
  const hidden = Object.values(cells).filter((c) => c === SUPPRESSED).length;
  if (hidden !== 1) return cells;
  const shown = Object.keys(cells)
    .filter((k) => cells[k] !== SUPPRESSED && (sizes[k] ?? 0) > 0)
    .sort((a, b) => (sizes[a] ?? 0) - (sizes[b] ?? 0) || (a < b ? -1 : 1));
  const victim = shown[0];
  return victim === undefined ? cells : { ...cells, [victim]: SUPPRESSED };
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

export interface MirrorResult {
  vaults: number;
  mirrored: number;
  not_mirrored: number;
  lookup_failed: number;
}

export interface WeekGas {
  ops: number;
  wei: string;
  eth: string;
}

export interface SponsoredGas {
  ops: Cell;
  total_wei: string;
  total_eth: string;
  per_week: Record<string, WeekGas | typeof SUPPRESSED>;
  excluded: { unsponsored_ops: Cell; other_paymaster_ops: Cell; other_paymaster_wei: string };
  paymasters_configured: number;
}

export interface Report {
  schema: typeof SCHEMA;
  generated_at: string;
  network: string;
  chain_id: number;
  registries: { version: string; address: string; from_block: number; to_block: number }[];
  suppression: { min_cell: number; applied: boolean };
  vaults_total: Cell;
  vaults_by_registry: Record<string, Cell>;
  created: Record<string, Cell>;
  updates_total: Cell;
  updates: Record<string, Cell>;
  weekly_active: Record<string, Cell>;
  keys_per_vault: Record<string, Cell>;
  mirror_coverage: MirrorResult | null;
  sponsored_gas: SponsoredGas | null;
  notes: string[];
}

export interface ReportInput {
  network: string;
  chainId: number;
  public: boolean;
  registries: { version: number; address: string; fromBlock: bigint; toBlock: bigint }[];
  events: VaultEvent[];
  vaults: Map<string, VaultFacts>;
  mirror: MirrorResult | null;
  gas: { ops: GasOp[]; paymasters: number } | null;
  notes: string[];
  now: Date;
}

const sorted = <T>(m: Map<string, T>) => new Map([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Per-week buckets: shown value = events (or vaults), suppression judged by the distinct vaults in the bucket. */
function weekly(events: VaultEvent[], kinds: EventKind[], count: 'events' | 'vaults', applied: boolean, summed: boolean): Record<string, Cell> {
  const byWeek = new Map<string, { events: number; vaults: Set<string> }>();
  for (const e of events) {
    if (!kinds.includes(e.kind)) continue;
    const w = isoWeek(e.ts);
    const b = byWeek.get(w) ?? { events: 0, vaults: new Set<string>() };
    b.events++;
    b.vaults.add(e.vault);
    byWeek.set(w, b);
  }
  const out: Record<string, Cell> = {};
  const sizes: Record<string, number> = {};
  for (const [w, b] of sorted(byWeek)) {
    out[w] = suppress(count === 'events' ? b.events : b.vaults.size, b.vaults.size, applied);
    sizes[w] = b.vaults.size;
  }
  return summed ? complement(out, sizes) : out;
}

function distribution(values: string[], applied: boolean): Record<string, Cell> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const out: Record<string, Cell> = {};
  const keys = [...counts.keys()].sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(a) - Number(b) || (a < b ? -1 : 1)));
  for (const k of keys) out[k] = suppress(counts.get(k) ?? 0, counts.get(k) ?? 0, applied);
  return complement(out, Object.fromEntries(counts));
}

const eth = (wei: bigint) => formatEther(wei);

function sponsoredGas(gas: { ops: GasOp[]; paymasters: number }, applied: boolean): SponsoredGas {
  const sponsored = gas.ops.filter((o) => o.sponsored);
  const total = sponsored.reduce((s, o) => s + o.wei, 0n);
  const byWeek = new Map<string, { ops: number; wei: bigint; senders: Set<string> }>();
  for (const o of sponsored) {
    const w = isoWeek(o.ts);
    const b = byWeek.get(w) ?? { ops: 0, wei: 0n, senders: new Set<string>() };
    b.ops++;
    b.wei += o.wei;
    b.senders.add(o.sender);
    byWeek.set(w, b);
  }
  let per_week: SponsoredGas['per_week'] = {};
  const sizes: Record<string, number> = {};
  for (const [w, b] of sorted(byWeek)) {
    // a week's gas sum with fewer than MIN_CELL distinct accounts could point at single operations
    per_week[w] = applied && b.senders.size < MIN_CELL ? SUPPRESSED : { ops: b.ops, wei: b.wei.toString(), eth: eth(b.wei) };
    sizes[w] = b.senders.size;
  }
  per_week = complement(per_week, sizes);
  const senders = (ops: GasOp[]) => new Set(ops.map((o) => o.sender)).size;
  const hide = applied && senders(sponsored) > 0 && senders(sponsored) < MIN_CELL;
  const other = gas.ops.filter((o) => o.otherPaymaster);
  const unsponsored = gas.ops.filter((o) => !o.sponsored && !o.otherPaymaster);
  const hideOther = applied && senders(other) > 0 && senders(other) < MIN_CELL;
  return {
    ops: hide ? SUPPRESSED : sponsored.length,
    total_wei: hide ? SUPPRESSED : total.toString(),
    total_eth: hide ? SUPPRESSED : eth(total),
    per_week,
    excluded: {
      unsponsored_ops: suppress(unsponsored.length, senders(unsponsored), applied),
      other_paymaster_ops: hideOther ? SUPPRESSED : other.length,
      other_paymaster_wei: hideOther ? SUPPRESSED : other.reduce((s, o) => s + o.wei, 0n).toString(),
    },
    paymasters_configured: gas.paymasters,
  };
}

export function buildReport(input: ReportInput): Report {
  const applied = input.public;
  const facts = [...input.vaults.values()];
  const updates = input.events.filter((e) => e.kind === 'updated');
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
    suppression: { min_cell: MIN_CELL, applied },
    vaults_total: suppress(facts.length, facts.length, applied),
    vaults_by_registry: distribution(facts.map((f) => `v${f.registry}`), applied),
    created: weekly(input.events, ['created'], 'vaults', applied, true),
    updates_total: suppress(updates.length, new Set(updates.map((e) => e.vault)).size, applied),
    updates: weekly(input.events, ['updated'], 'events', applied, true),
    // weekly_active has no published total (a vault can be active in many weeks), so no complement is needed
    weekly_active: weekly(input.events, ['created', 'updated', 'locator'], 'vaults', applied, false),
    keys_per_vault: distribution(facts.map((f) => (f.keys === null ? 'unknown' : String(f.keys))), applied),
    mirror_coverage: input.mirror,
    sponsored_gas: input.gas ? sponsoredGas(input.gas, applied) : null,
    notes: input.notes,
  };
  // vaults_by_registry keys are "v1", "v2"...: keep version order rather than string order
  report.vaults_by_registry = Object.fromEntries(Object.entries(report.vaults_by_registry).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))));
  assertNoIdentifiers(report);
  return report;
}
