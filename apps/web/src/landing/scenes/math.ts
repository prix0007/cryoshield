/** Pure helpers for scroll scenes (cinematic-landing D1). */

/** Progress within the sub-interval [a, b] of p, clamped to 0..1. */
export function range(p: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export function yearAt(p: number, from: number, to: number): number {
  return Math.round(from + (to - from) * Math.min(1, Math.max(0, p)));
}

const HEX = '0123456789abcdef';
const frac = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Deterministic "plaintext -> ciphertext" scramble: each character flips to hex at its own threshold in (0, 1]. */
export function scramble(text: string, p: number): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const threshold = 0.05 + 0.95 * frac(i + 1);
    out += p >= threshold ? HEX[Math.floor(frac(i * 31 + text.charCodeAt(i)) * 16)] : text[i];
  }
  return out;
}
