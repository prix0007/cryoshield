# @cryoshield/vault-crypto

The CryoShield vault format v1. A pure TypeScript library (no I/O, no WebAuthn calls) that runs in browsers and in Node 20+.

```
WebAuthn PRF output ──HKDF-SHA256──► locator   (on-chain lookup key)
                    └─HKDF-SHA256──► wrapKey ──AES-256-GCM──► data key ──AES-256-GCM──► secret
```

- **Symmetric only:** HKDF-SHA256 and AES-256-GCM (`@noble/hashes`, `@noble/ciphers`). Randomness comes from WebCrypto.
- **One tap per key.** One PRF input for everything, and `userVerification: "required"` always.
- **Any-of-N (default, N = 2..8).** Any single enrolled key unlocks. Adding a key needs only one existing key.
- **Shamir M-of-N: EXPERIMENTAL.** It is supported in the format, the library, and the vectors, but it is not part of the MVP default flow and its API may change. Built on `shamir-secret-sharing` 0.0.4; see `docs/reviews/shamir-dependency.md`.
- **Blobs are ≤ 1024 bytes**, padded so the exact secret length is hidden.

Normative spec: [`docs/spec/vault-format-v1.md`](../../docs/spec/vault-format-v1.md). Test vectors: [`test-vectors/v1.json`](test-vectors/v1.json).

## API

```ts
import {
  webauthnPrfCreateOptions, webauthnPrfGetOptions, assertUserVerified,
  deriveLocator, createVault, selectVault, openVault,
  addKey, updatePayload, decodeVault, maxPayloadBytes, VaultError,
} from '@cryoshield/vault-crypto';
```

| Function | Purpose | Wipes the caller's PRF buffers? |
|---|---|---|
| `webauthnPrfCreateOptions()` | `{ authenticatorSelection: { userVerification: 'required', residentKey: 'required' }, extensions: { prf: { eval: { first } } } }`, to spread into `navigator.credentials.create({ publicKey })`. `create()` ignores a top-level `userVerification`. | n/a |
| `webauthnPrfGetOptions()` | `{ userVerification: 'required', extensions: { prf: { eval: { first } } } }`, to spread into `navigator.credentials.get({ publicKey })` | n/a |
| `assertUserVerified(authenticatorData)` | **Call this on every create/get response before using its PRF output.** It throws `USER_NOT_VERIFIED` if the UV flag (bit 2) is clear. | n/a |
| `locatorSalt()` / `ctapSalt()` | the single PRF input, and its CTAP2 `hmac-secret` equivalent | n/a |
| `deriveLocator(prf)` | the 32-byte on-chain locator for one key | **no** (you still need `prf` for the open) |
| `deriveWrapKey(prf, wrapSalt)` | low-level; you must wipe the result | no |
| `createVault({ vaultId, rpId, credentials, secret, mode?, threshold? }, { rng? })` | → `{ blob, locators }`, bound to `vaultId` | yes |
| `selectVault(candidates: { vaultId, blob }[], prf)` | squatting- and clone-tolerant unlock → `{ index, vaultId, secret }` | yes |
| `openVault(blob, key \| keys, vaultId)` | → `secret`; `key = { prf, credId? }` | yes |
| `addKey(blob, existingKey, vaultId, { id, prf }, { rng? })` | mode 0x01 only → `{ blob, locator }` | yes (both) |
| `updatePayload(blob, key \| keys, vaultId, newSecret, { rng? })` | → new `blob` (same data key, fresh nonce) | yes |

**`vaultId` (32 bytes, non-zero) binds the blob to its registry slot.**
- It is never stored in the blob. Pass the id you **read the blob from**: the registry's `vaultId` key, or the Arweave `CryoShield-Vault-Id` tag.
- A byte-identical clone under another `vaultId` fails with `NO_MATCHING_KEY`, and `selectVault` skips it.
- At creation, choose a random `vaultId` before encrypting. If registration reverts because the id is taken, create a fresh blob under a new `vaultId`; this needs every key's PRF output again.
| `decodeVault(blob)` / `encodeVault(fields)` | byte layout only, no crypto | n/a |
| `maxPayloadBytes(rpId, credIds, mode?)` | capacity to show in the UI before saving | n/a |

Test-only helpers live in a separate entry point, `@cryoshield/vault-crypto/testing`: `replayRng` and `RngExhaustedError`, a deterministic RNG for reproducing vectors. Never import it in production.

Constants: `MODE_ANY_OF_N`, `MODE_SHAMIR`, `MAX_BLOB_BYTES`, `VAULT_ID_BYTES`, `MIN_KEYS`, `MAX_KEYS`, `FORMAT_VERSION`, `SUITE_HKDF_SHA256_AES256GCM`, and `USER_VERIFICATION`.
Types: `Credential`, `UnlockKey`, `CreateVaultParams`, `CreateVaultResult`, `VaultCandidate`, `SelectVaultResult`, `AddKeyResult`, `RngOptions`, `DecodedVault`, `VaultEntry`, `VaultFields`, `VaultMode`, `VaultErrorCode`, `WebAuthnPrfCreateOptions`, `WebAuthnPrfGetOptions`, `PrfExtensionInput`, `Rng`.

Every failure is a `VaultError` with a stable `code`:
- `BAD_MAGIC`, `UNSUPPORTED_VERSION`, `UNSUPPORTED_SUITE`, `UNSUPPORTED_MODE`, `MALFORMED`;
- `VAULT_TOO_LARGE`, which also carries `maxPayloadBytes`;
- `TOO_FEW_KEYS`, `TOO_MANY_KEYS`, `INVALID_ARGUMENT`;
- `NO_MATCHING_KEY`, `INSUFFICIENT_SHARES`, `AUTH_FAILED`, `NO_MATCHING_VAULT`;
- `USER_NOT_VERIFIED`, from `assertUserVerified`.

Error messages never say which cryptographic step failed beyond the code.

### Create a vault (2 keys, one tap each)

```ts
import { createVault, webauthnPrfCreateOptions, webauthnPrfGetOptions, assertUserVerified } from '@cryoshield/vault-crypto';

// Register each key with navigator.credentials.create({ publicKey: { ...webauthnPrfCreateOptions(), rp, user, challenge, … } }).
// Its PRF output comes from create() (or from a get() with webauthnPrfGetOptions()), and
// assertUserVerified(response.authenticatorData) must pass before that output is used.
declare const credIdA: Uint8Array, prfA: Uint8Array, credIdB: Uint8Array, prfB: Uint8Array;
declare const authDataA: Uint8Array, authDataB: Uint8Array;

assertUserVerified(authDataA); // throws VaultError('USER_NOT_VERIFIED') without UV
assertUserVerified(authDataB);
const request = { create: webauthnPrfCreateOptions(), get: webauthnPrfGetOptions() };
const vaultId = crypto.getRandomValues(new Uint8Array(32)); // client-chosen registry id
const { blob, locators } = await createVault({
  vaultId,
  rpId: 'cryoshield.app',
  credentials: [{ id: credIdA, prf: prfA }, { id: credIdB, prf: prfB }],
  secret: new TextEncoder().encode('abandon abandon … art'),
});
// prfA and prfB are now all zeros. Register `blob` on chain under exactly this `vaultId`, with `locators`.
console.log(request.create.authenticatorSelection.userVerification, request.get.userVerification, blob.length, locators.length);
```

### Unlock (single tap, squatting-tolerant)

```ts
import { deriveLocator, selectVault, VaultError } from '@cryoshield/vault-crypto';

declare const prf: Uint8Array; // one get() with webauthnPrfGetOptions(), after assertUserVerified()
// Resolve the locator to vaultIds, then read each vault's blob. Keep every blob paired with
// the vaultId it was READ under; never take a vaultId from the blob's own content.
declare function fetchBlobsByLocator(locator: Uint8Array): Promise<{ vaultId: Uint8Array; blob: Uint8Array }[]>;

const locator = deriveLocator(prf);               // prf is NOT wiped yet
let candidates: { vaultId: Uint8Array; blob: Uint8Array }[];
try {
  candidates = await fetchBlobsByLocator(locator);
} catch (e) {
  prf.fill(0);                                    // YOUR job: the library never saw this failure
  throw e;
}
try {
  const { index, vaultId, secret } = await selectVault(candidates, prf); // prf wiped here
  // use `vaultId` for every later addKey/updatePayload and on-chain update
  console.log(`vault #${index}`, vaultId.length, new TextDecoder().decode(secret));
} catch (e) {
  if (e instanceof VaultError && e.code === 'NO_MATCHING_VAULT') console.log('no vault for this key');
  else throw e;
}
```

### Add a key with one existing key, then edit the secret

```ts
import { addKey, updatePayload, maxPayloadBytes, decodeVault } from '@cryoshield/vault-crypto';

declare const blob: Uint8Array, vaultId: Uint8Array; // from selectVault
declare const prfExisting: Uint8Array, newCredId: Uint8Array, prfNew: Uint8Array, prfAny: Uint8Array;

const added = await addKey(blob, { prf: prfExisting }, vaultId, { id: newCredId, prf: prfNew });
// register added.locator on chain; store added.blob

const d = decodeVault(added.blob);
const room = maxPayloadBytes(d.rpId, d.entries.map((e) => e.credId), d.mode);
const edited = await updatePayload(added.blob, { prf: prfAny }, vaultId, new TextEncoder().encode('new codes'));
console.log(room, edited.length);
```

### Shamir 2-of-3 (experimental)

```ts
import { createVault, openVault, MODE_SHAMIR } from '@cryoshield/vault-crypto';

declare const keys: { id: Uint8Array; prf: Uint8Array }[]; // 3 credentials
declare const prfA: Uint8Array, prfC: Uint8Array, vaultId: Uint8Array;

const { blob } = await createVault({
  vaultId, rpId: 'cryoshield.app', credentials: keys, secret: new Uint8Array([1, 2, 3]), mode: MODE_SHAMIR, threshold: 2,
});
const secret = await openVault(blob, [{ prf: prfA }, { prf: prfC }], vaultId); // any 2 of the 3
console.log(secret.length);
```

## Size budget

Blob cap: 1024 bytes. The overhead is the header (42 + RP ID length), plus 1 + credIdLen + 12 + 48 per key (+49 in Shamir mode), plus 28 for the payload nonce and tag. The secret is padded with a 2-byte length prefix to a multiple of 64.

Figures for RP ID `cryoshield.app` (14 bytes):

| Mode | Keys | Credential IDs | Overhead | Max secret (`maxPayloadBytes`) |
|---|---|---|---|---|
| any-of-N | 2 | 64 B | 334 | **638** |
| any-of-N | 3 | 64 B | 459 | 510 |
| any-of-N | 4 | 64 B | 584 | 382 |
| any-of-N | 8 | 64 B | 1084 | does not fit; use shorter credential IDs |
| any-of-N | 8 | 16 B | 700 | 318 |
| Shamir | 3 | 64 B | 462 | 510 |

A 24-word BIP39 seed phrase (≈ 150–220 bytes) plus ten TOTP backup codes fits easily with 2 or 3 keys.

## Security notes

- **PRF buffers.** Functions that consume PRF outputs overwrite your `Uint8Array`s with zeros when they return or throw. `deriveLocator` does not, because the single-tap flow still needs the PRF output.
  - **If anything fails between `deriveLocator` and `selectVault`/`openVault`** (for example, the candidate fetch throws), you must zero the PRF output yourself (`prf.fill(0)`).
  - Never persist or log PRF outputs.
- **User verification.** Use `webauthnPrfCreateOptions()` for `create()`, because UV must sit in `authenticatorSelection` there, and `webauthnPrfGetOptions()` for `get()`. Call `assertUserVerified(authenticatorData)` before using any PRF output.
  - Without UV, an authenticator evaluates the PRF with `CredRandomWithoutUV`, and the vault could never be opened by a UV ceremony or by the recovery tool.
- **`selectVault` returns the first candidate that authenticates, with its index**, and stops there. If one key opens several vaults, handling the duplicates is the caller's job.
- **Nonces.** `updatePayload` and `addKey` keep the data key and draw a fresh payload nonce. They throw if the RNG returns the blob's current nonce.
- **Zeroization is best effort.** JavaScript engines and WebCrypto may keep copies.
- **Authentication failures.** These surface as `NO_MATCHING_KEY` (no entry unwraps; tampering inside a wrap AAD looks the same) or `AUTH_FAILED` (the payload did not authenticate).
- **Locators are public.** Anyone can append blobs under them on chain, including byte-identical clones of your blob under their own `vaultId`. `selectVault` skips both junk and clones, so always use it for lookups, and always pair each blob with the `vaultId` it was read under.

## Reimplementing the format

Implementations in other languages, such as the Python desktop recovery tool, need only:

1. **The spec:** [`docs/spec/vault-format-v1.md`](../../docs/spec/vault-format-v1.md). It gives the byte layout, the derivations, the AAD rules, the decoding order, and the error codes.
2. **The vectors:** [`test-vectors/v1.json`](test-vectors/v1.json). Pass every case, positive and negative, with the exact error code.
3. **A cross-check:** [`scripts/gen-vectors.py`](scripts/gen-vectors.py) is an independent Python implementation (the `cryptography` library + hashlib), including GF(2^8) Shamir. It generates the vectors.
   - `python scripts/gen-vectors.py --check` verifies byte-identical regeneration.
   - Install its dependencies with `pip install --require-hashes -r scripts/requirements.txt` (hash-pinned; the unpinned inputs are in `scripts/requirements.in`).
4. **The payload inside the secret** (not part of this library): [`docs/spec/payload-v2.md`](../../docs/spec/payload-v2.md) and its vectors [`docs/spec/payload-vectors.json`](../../docs/spec/payload-vectors.json), generated by [`scripts/gen-payload-vectors.py`](scripts/gen-payload-vectors.py) (`--check` as above). `test/payload-vectors.test.ts` rebuilds every blob vector with this library and the replay RNG; `test/payload-vectors-regen.node.test.ts` runs the generator's `--check` when `scripts/.venv` exists, and fails instead of skipping when `CRYOSHIELD_REQUIRE_PY_VECTORS=1`.

For CTAP2 `hmac-secret`: use salt = `constants.ctapSalt`, and **always use user verification** (PIN/UV). Without UV, the authenticator uses a different secret (`CredRandomWithoutUV`) and the outputs won't match.

### `test-vectors/v1.json` schema

All byte strings are **lowercase hex**. Integers are JSON numbers, and `null` means absent.

```jsonc
{
  "name": "cryoshield-vault-v1",
  "formatVersion": 1,
  "spec": "docs/spec/vault-format-v1.md",
  "generatedBy": "packages/vault-crypto/scripts/gen-vectors.py",
  "encoding": "…",
  "constants": {
    "magic": hex, "version": 1, "suite": 1, "modeAnyOfN": 1, "modeShamir": 2,
    "maxBlobBytes": 1024, "minKeys": 2, "maxKeys": 8,
    "locatorSaltInput": "cryoshield/v1/locator-salt",   // ASCII
    "locatorSalt": hex,       // SHA-256(locatorSaltInput) = the WebAuthn PRF input
    "ctapSalt": hex,          // SHA-256("WebAuthn PRF" || 0x00 || locatorSalt) = CTAP2 hmac-secret salt
    "infoLocator": "cryoshield/v1/locator", "infoWrap": "cryoshield/v1/wrap",
    "userVerification": "required",
    "uvFlagMask": 4,          // authenticatorData[32] & uvFlagMask must be nonzero
    "shamirField": "GF(2^8) mod 0x11B"
  },
  "derivations": [            // HKDF checks per key
    { "name", "prf", "prfInput", "ctapSalt", "locator", "wrapSalt", "wrapKey" }
  ],
  "vaults": [                 // positive vectors: creation must reproduce `blob` byte for byte
    {
      "name", "description", "vaultId": hex,   // bound into every AAD, not stored in the blob
      "mode": 1 | 2, "threshold": int, "rpId": string, "keys": ["A", …],
      "secret": hex, "secretUtf8": string | null,
      "wrapSalt", "dataKey", "payloadNonce": hex,
      "rng": hex,             // library draws, in order: wrapSalt(32) dataKey(32) wrapNonce[i](12)… payloadNonce(12)
      "shamirRng": hex | null,// Shamir lib draws: 255 shuffle bytes, then (M-1) coefficients per data-key byte
      "shamir": null | { "field", "shares": [ { "x": int, "y": hex, "wrapPlaintext": hex /* x||y */ } ] },
      "credentials": [
        { "id", "prf", "prfInput", "ctapSalt", "locator", "wrapKey",
          "wrapNonce", "wrapAad", "wrapPlaintext", "wrapped": hex }
      ],
      "paddedPlaintext", "payloadAad": hex,  // payloadAad = blob[0..P) || vaultId
      "maxPayloadBytes": int, "blob": hex, "blobLength": int
    }
  ],
  "decodeCases": [            // decodeVault(blob)
    { "name", "description", "blob": hex,
      "expected"?: { "mode", "threshold", "rpId", "wrapSalt", "credIds": [hex], "headerLength", "payloadOffset" },
      "expectedError"?: CODE }
  ],
  "openCases": [              // openVault(blob, keys, vaultId)
    { "name", "description", "vault": string | null, "vaultId": hex, "blob": hex,
      "keys": [ { "prf", "credId": hex | null, "prfInput", "ctapSalt" } ],
      "expectedSecret"?: hex, "expectedError"?: CODE }
  ],
  "createCases": [            // createVault refusals; nothing random is drawn
    { "name", "description", "vaultId": hex, "rpId", "mode", "threshold",
      "credentials": [ { "id", "prf" } ], "secret": hex,
      "expectedError": CODE, "maxPayloadBytes"?: int }
  ],
  "addKeyCases": [            // addKey(blob, key, vaultId, newCredential), rng = wrapNonce(12) || payloadNonce(12)
    { "name", "description", "vault", "vaultId": hex, "blob": hex,
      "key": { "prf", "credId", "prfInput", "ctapSalt" },
      "newCredential": { "id", "prf", "locator" }, "rng": hex,
      "expectedBlob"?: hex, "expectedBlobLength"?: int, "expectedError"?: CODE }
  ],
  "updatePayloadCases": [     // updatePayload(blob, keys, vaultId, newSecret), rng = payloadNonce(12)
    { "name", "description", "vault", "vaultId": hex, "blob": hex, "keys": [ … ], "newSecret": hex, "rng": hex,
      "expectedBlob"?: hex, "expectedError"?: CODE, "maxPayloadBytes"?: int }
  ],
  "selectCases": [            // selectVault(candidates, prf)
    { "name", "description", "prf", "credId": null, "prfInput", "ctapSalt",
      "candidateKinds": [string], "candidates": [ { "vaultId": hex, "blob": hex } ],
      "expectedIndex"?: int, "expectedVaultId"?: hex, "expectedSecret"?: hex, "expectedError"?: CODE }
  ],
  "authenticatorDataCases": [ // assertUserVerified(authenticatorData)
    { "name", "description", "authenticatorData": hex, "expectedError": CODE | null /* null = accepted */ }
  ],
  "vaultIdDerivation": [      // VaultRegistry v2: vaultId = keccak256(abi.encode(address owner, bytes32 salt))
    { "name", "description", "owner": hex /* 20 bytes */, "salt": hex /* 32 bytes */,
      "abiEncoded": hex /* 0x00 x 12 || owner || salt */, "vaultId": hex }
  ]
}
```

`CODE` is one of the error codes listed above. Each case has exactly one of the expected-success fields or `expectedError`.

Test inputs (PRF outputs, credential IDs, salts, nonces) are derived as `SHA-256("cryoshield-vectors/v1/" || label || "/" || u32be(i))` blocks. That is only for reproducibility, and has no meaning for the format.

## Development

```sh
pnpm --filter @cryoshield/vault-crypto test          # Node: vectors, unit, property (10k runs), README doctest
pnpm --filter @cryoshield/vault-crypto test:browser  # same suite in headless Chromium (Vitest browser mode)
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install --require-hashes -r scripts/requirements.txt
scripts/.venv/bin/python scripts/gen-vectors.py --check
scripts/.venv/bin/python scripts/gen-payload-vectors.py --check   # docs/spec/payload-vectors.json
```
