/**
 * VaultRegistry v2 vaultId derivation (change harden-gas-sponsorship, design D9, task 3.1):
 *   vaultId = keccak256(abi.encode(address owner, bytes32 salt))
 * abi.encode of (address, bytes32) is two 32-byte words: the 20-byte address left-padded
 * with 12 zero bytes, then the salt. The registry derives the id; the web app recomputes it
 * before encrypting (the id is in the AAD). This suite pins the published vector cases,
 * which the Solidity tests (vaultIdFor) check too. Runs in Node and in the browser.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/v1.json' with { type: 'json' };
import { VAULT_ID_BYTES } from '../src/index.js';

const hex = (s: string): Uint8Array => {
  if (!/^(?:[0-9a-f]{2})*$/.test(s)) throw new Error(`not lowercase hex: ${s}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

type DerivationCase = { name: string; description: string; owner: string; salt: string; abiEncoded: string; vaultId: string };

/** abi.encode(address, bytes32): explicit lengths, no 0x prefix, lowercase. */
function abiEncodeOwnerSalt(owner: Uint8Array, salt: Uint8Array): Uint8Array {
  if (owner.length !== 20) throw new Error('owner must be 20 bytes');
  if (salt.length !== 32) throw new Error('salt must be 32 bytes');
  const out = new Uint8Array(64);
  out.set(owner, 12);
  out.set(salt, 32);
  return out;
}

const cases = (vectors as unknown as { vaultIdDerivation?: DerivationCase[] }).vaultIdDerivation;

describe('vaultIdDerivation (registry v2: keccak256(abi.encode(owner, salt)))', () => {
  it('is published with the expected cases', () => {
    expect(Array.isArray(cases)).toBe(true);
    const names = (cases ?? []).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    // Cases shared with contracts/test/fixtures/vaultIdDerivation.json, plus the edge cases.
    for (const n of ['typical-repeated-bytes', 'anvil-0-zero-salt', 'typical-random', 'zero-owner-zero-salt',
      'max-owner-max-salt', 'max-owner-zero-salt', 'zero-owner-max-salt', 'salt-low-bit', 'typical-det',
      'typical-det-other-owner']) {
      expect(names).toContain(n);
    }
  });

  it('keccak-256 is Keccak (not NIST SHA3-256)', () => {
    expect(toHex(keccak_256(new Uint8Array(0)))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });

  for (const c of cases ?? []) {
    it(`${c.name}`, () => {
      const owner = hex(c.owner);
      const salt = hex(c.salt);
      expect(owner.length).toBe(20);
      expect(salt.length).toBe(32);
      const encoded = abiEncodeOwnerSalt(owner, salt);
      expect(toHex(encoded)).toBe(c.abiEncoded);
      const id = keccak_256(encoded);
      expect(id.length).toBe(VAULT_ID_BYTES);
      expect(toHex(id)).toBe(c.vaultId);
    });
  }

  it('the same salt under different owners gives different ids (no squatting)', () => {
    const bySalt = new Map<string, Set<string>>();
    for (const c of cases ?? []) {
      const s = bySalt.get(c.salt) ?? new Set<string>();
      s.add(c.vaultId);
      bySalt.set(c.salt, s);
    }
    for (const c of cases ?? []) {
      const sameSalt = (cases ?? []).filter((d) => d.salt === c.salt);
      expect(bySalt.get(c.salt)?.size).toBe(new Set(sameSalt.map((d) => d.owner)).size);
    }
  });
});
