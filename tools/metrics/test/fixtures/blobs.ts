// Blob fixtures: vault-format-v1 headers (docs/spec/vault-format-v1.md §5) with filler bytes. Only the cleartext
// header matters to the metrics tool (key count N at offset 8); nothing here is real key material.
export function fixtureBlob(keys: number, opts: { mode?: 1 | 2; seed?: number; rpId?: string } = {}): Uint8Array {
  const mode = opts.mode ?? 1;
  const rpId = new TextEncoder().encode(opts.rpId ?? 'cryoshield.app');
  const seed = opts.seed ?? 1;
  const out: number[] = [0x43, 0x52, 0x59, 0x4f, 0x01, 0x01, mode, mode === 1 ? 1 : 2, keys, rpId.length, ...rpId];
  let x = seed & 0xff;
  const fill = (n: number) => {
    for (let i = 0; i < n; i++) out.push((x = (x * 31 + 7) & 0xff));
  };
  fill(32); // wrapSalt
  for (let i = 0; i < keys; i++) {
    out.push(16);
    fill(16 + 12 + (mode === 1 ? 48 : 49)); // credId, wrapNonce, wrapped
  }
  fill(12 + 80); // payloadNonce, payloadCt (k = 1)
  return Uint8Array.from(out);
}
