import { gcm } from '@noble/ciphers/aes.js';

/** AES-256-GCM, 96-bit nonce, 128-bit tag. Returns ciphertext || tag. */
export function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return gcm(key, nonce, aad).encrypt(plaintext);
}

/** Returns the plaintext, or null if authentication fails. Never says why. */
export function unseal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array | null {
  try {
    return gcm(key, nonce, aad).decrypt(ciphertext);
  } catch {
    return null;
  }
}
