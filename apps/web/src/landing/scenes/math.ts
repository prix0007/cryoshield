/** Pure helpers for scroll scenes (cinematic-landing D1). */

/** Progress within the sub-interval [a, b] of p, clamped to 0..1. */
export function range(p: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export function yearAt(p: number, from: number, to: number): number {
  return Math.round(from + (to - from) * Math.min(1, Math.max(0, p)));
}

const frac = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Plaintext -> ciphertext, resolved character by character as a left-to-right sweep with a little jitter (so the line
 * reads as "sealed part | plain part", not as interleaved word fragments). Position i flips to its final ciphertext
 * character once p passes its threshold in (0, 1]. Deterministic and monotonic; at p = 1 it is exactly `cipher`.
 */
export function resolveCipher(plain: string, cipher: string, p: number): string {
  const n = cipher.length;
  const from = plain.padEnd(n).slice(0, n);
  let out = '';
  for (let i = 0; i < n; i++) {
    const threshold = Math.min(1, 0.04 + (0.9 * i) / Math.max(1, n - 1) + 0.06 * frac(i + 1));
    out += p >= threshold ? cipher[i] : from[i];
  }
  return out;
}
