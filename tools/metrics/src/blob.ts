// The cleartext key count N of a vault blob (docs/spec/vault-format-v1.md §5: magic "CRYO", version 0x01, N at
// offset 8, 2 <= N <= 8, total <= 1024 bytes). Nothing else in the blob is read.
export const MAX_BLOB = 1024;

export function keyCount(blob: Uint8Array): number | null {
  if (blob.length < 9 || blob.length > MAX_BLOB) return null;
  if (blob[0] !== 0x43 || blob[1] !== 0x52 || blob[2] !== 0x59 || blob[3] !== 0x4f || blob[4] !== 0x01) return null;
  const n = blob[8] ?? 0;
  return n >= 2 && n <= 8 ? n : null;
}
