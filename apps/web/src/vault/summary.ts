/**
 * Vault list row summary (vault-list-labels-archive 2.2, design D5 and the display-time requirements). Holds the name,
 * status, counts and up to three truncated labels. Never a secret value.
 */
import type { SecretItem } from './payload';
import { capMarks, INVISIBLE, visibleName } from './name';

export { visibleName };

export type VaultStatus = 'active' | 'archived' | 'older';

export interface VaultSummary {
  /** The name to show, or undefined: the UI shows "Unnamed vault". */
  name: string | undefined;
  status: VaultStatus;
  count: number;
  /** Up to 3 labels, each at most 24 code points (plus an ellipsis). */
  labels: string[];
  /** Labels not shown ("+N more"). */
  more: number;
  keys: number;
}

const LABEL_MAX = 24;
const SHOWN = 3;

/** At most 24 code points, never splitting a surrogate pair (iterates code points, not UTF-16 units). */
export function truncateLabel(label: string): string {
  const cps = [...label];
  return cps.length <= LABEL_MAX ? label : cps.slice(0, LABEL_MAX).join('') + '\u2026';
}

export function summarize(v: { name?: string; archived: boolean; items: readonly SecretItem[]; registry: 'v1' | 'v2'; keyCount: number }): VaultSummary {
  return {
    name: visibleName(v.name),
    status: v.registry === 'v1' ? 'older' : v.archived ? 'archived' : 'active',
    count: v.items.length,
    labels: v.items.slice(0, SHOWN).map((it, i) => (INVISIBLE.test(it.label) ? `Secret ${i + 1}` : truncateLabel(capMarks(it.label)))),
    more: Math.max(0, v.items.length - SHOWN),
    keys: v.keyCount,
  };
}
