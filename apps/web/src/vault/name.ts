/**
 * How a vault name is shown (vault-list-labels-archive display-time requirements). Kept apart from summary.ts so only
 * this small part is in the initial /app chunk (the vault heading); the row summaries ship with the vault list.
 */
/**
 * Nothing visible left: only white space, format controls (joiners, marks), combining marks, controls, or the
 * blank-looking fillers (Hangul fillers, the braille blank).
 */
export const INVISIBLE = /^[\p{White_Space}\p{Cf}\p{M}\p{Cc}\u115f\u1160\u3164\uffa0\u2800]*$/u;

/**
 * Display only (review LOW): runs of more than 3 combining marks are shortened to 3, so a stack of marks can't paint over
 * the rows around it. The stored name is untouched; the codec accepts what docs/spec/payload-v2.md allows.
 */
export const capMarks = (t: string) => t.replace(/(\p{M}{3})\p{M}+/gu, '$1');

/** The name to show, or undefined when it has no visible glyph (shown as "Unnamed vault"). */
export const visibleName = (name: string | undefined): string | undefined => (name === undefined || INVISIBLE.test(name) ? undefined : capMarks(name));
