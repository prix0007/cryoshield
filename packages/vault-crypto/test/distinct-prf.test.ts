/** REC-L2 (security audit 2026-10) and the ECC review of PR #22: duplicate PRF outputs at creation. */
import { describe, expect, it } from 'vitest';
import { createVault, MODE_SHAMIR, VaultError } from '../src/index.js';

const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const vaultId = (): Uint8Array => {
  const v = rand(32);
  v[0] = 1;
  return v;
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VaultError) return e.code;
    throw e;
  }
  return 'OK';
}

describe('createVault rejects duplicate PRF outputs', () => {
  it('rejects them in Shamir mode too, and wipes every PRF buffer', async () => {
    const prf = rand(32);
    const creds = [
      { id: rand(16), prf: prf.slice() },
      { id: rand(16), prf: prf.slice() },
      { id: rand(16), prf: rand(32) },
    ];
    const c = await code(
      createVault({ vaultId: vaultId(), rpId: 'cryoshield.app', credentials: creds, secret: rand(8), mode: MODE_SHAMIR, threshold: 2 }),
    );
    expect(c).toBe('INVALID_ARGUMENT');
    for (const cr of creds) expect(Array.from(cr.prf).every((b) => b === 0)).toBe(true);
  });

  it('accepts PRFs that differ only in the last byte', async () => {
    const a = rand(32);
    const b = a.slice();
    b[31] = (b[31] ?? 0) ^ 1;
    const c = await code(
      createVault({ vaultId: vaultId(), rpId: 'cryoshield.app', credentials: [{ id: rand(16), prf: a }, { id: rand(16), prf: b }], secret: rand(8) }),
    );
    expect(c).toBe('OK');
  });
});
