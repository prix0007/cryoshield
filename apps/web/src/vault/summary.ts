/**
 * Vault list row summary (vault-list-labels-archive 2.2, design D5 and the display-time requirements). Holds the name,
 * status, counts and up to three truncated labels. Never a secret value.
 */
import type { SecretItem } from './payload';

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

/**
 * Nothing visible left: only white space, format controls (joiners, marks), combining marks, controls, or the
 * blank-looking fillers (Hangul fillers, the braille blank).
 */
const INVISIBLE = /^[\p{White_Space}\p{Cf}\p{M}\p{Cc}\u115f\u1160\u3164\uffa0\u2800]*$/u;

/** The name as typed, or undefined when it has no visible glyph (shown as "Unnamed vault"). */
export const visibleName = (name: string | undefined): string | undefined => (name === undefined || INVISIBLE.test(name) ? undefined : name);

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
    labels: v.items.slice(0, SHOWN).map((it, i) => (INVISIBLE.test(it.label) ? `Secret ${i + 1}` : truncateLabel(it.label))),
    more: Math.max(0, v.items.length - SHOWN),
    keys: v.keyCount,
  };
}
