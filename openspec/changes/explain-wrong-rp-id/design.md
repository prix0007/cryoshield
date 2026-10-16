# Design

## Decisions

### D1. No key-check value: the per-credential wrap tag is one
A key-check value (a MAC of a fixed string under the derived key) would let a tool say "the key answered but the
derived key does not match" before touching the ciphertext. The v1 format already provides exactly that: the data key
is wrapped once per enrolled credential with AES-256-GCM (`vault-format-v1.md` §5), each entry carries its credential
ID, and the wrap's additional data binds the vault ID, the entry index, the RP ID and the wrap salt (§6). The
recovery tool matches the entry by the credential ID in the assertion (`vault.py` `_candidate_entries`) and verifies
that 48-byte wrap first; the payload is read only after a wrap authenticates. A separate check value would add bytes to
a frozen public format for no new information, so this change documents the check instead of adding one.

### D2. Where a wrong RP ID surfaces, path by path
| Path | What a wrong RP ID does | Message |
|---|---|---|
| Discovery (no identifier), key holds no credential for the name | the key returns no credential; no PRF output exists | `NO_DISCOVERABLE_CREDENTIAL`, which names `--rp-id` |
| Discovery, key holds a credential for the other name too (enrolled on the live and the development site) | a different PRF output, so a different locator; the other site's vaults or none are found | the existing "No vault unlocked with this key" message, which names `--rp-id` and `--network` |
| `--vault-id` / `--blob-file` | the RP ID is read from the vault's own header; `--rp-id` is only used when a found copy records it (`_rp_id_order`) | n/a: the name cannot be mistyped on this path |
| `--blob-file` with a wrong `--vault-id` | the wrap's additional data binds the vault ID, so no entry authenticates although the key answered | `DID_NOT_UNLOCK`, new wording: names `--vault-id` |
| `--vault-id` for a vault the key is not listed in | the allow list holds no credential the key has | `NOT_LISTED` |

### D3. "Listed", not "enrolled"
The key answering an allow-list assertion proves that the key holds a credential whose ID the copy lists. Credential
IDs are public, so an attacker-tagged Arweave copy can list a victim's credential IDs over junk wrapped keys. The
message therefore says "listed in that vault", and its second cause is a damaged copy, with the advice to try another
enrolled key or another source. The README uses the same word.

### D4. The message names the vault ID first
On the known-identifier path the RP ID comes from the header, the credential ID from the key, and the blob from the
source, so the only user-typed input that can break the wrap is `--vault-id` for a file. The message says so and
repeats the one fact the user needs (a vault only decrypts under the ID it was registered under, printed when the vault
was unlocked or saved). It does not mention `--rp-id`, which would send the user to the one thing that is not the
cause.

### D5. What the README claims, and the source of each claim
| Claim | Source |
|---|---|
| The single PRF input is `SHA-256("cryoshield/v1/locator-salt")` | `vault-format-v1.md` §3; `derive.py` `LOCATOR_SALT_INPUT`, `locator_salt()` |
| A CTAP2 client must send `SHA-256("WebAuthn PRF" \|\| 0x00 \|\| input)` as the hmac-secret salt | WebAuthn Level 3 PRF extension (§10.1.4, "SHA-256(UTF8Encode(\"WebAuthn PRF\") \|\| 0x00 \|\| first)"); `vault-format-v1.md` §3; `derive.py` `ctap_salt()`; `test_authenticator.py` pins the formula |
| Both salts appear in every vector | `vault-format-v1.md` §3 ("Both salts appear in every vector"); `packages/vault-crypto/test-vectors/` |
| The key returns no credential for a name it was not registered with, and the tool then names `--rp-id` | `recover.py` `NO_DISCOVERABLE_CREDENTIAL`; `test_recover.py` `test_no_discoverable_credential` |
| With a vault ID or file the RP ID comes from the vault's header | `format.py` (header field `rpId`); `recover.py` `_rp_id_order`; `vault-recovery` "Safe RP ID choice" |
| The data key is wrapped per credential under AES-256-GCM, matched by credential ID, checked before the payload | `vault-format-v1.md` §5, §6; `vault.py` `_candidate_entries`, `_unwrap`, `_data_key` |
| The wrap binds the vault ID | `vault-format-v1.md` §6 (`wrapAad` includes `vaultId`); `vault-recovery` "Candidates are opened under their own vault ID" |
| The two quoted messages are the tool's | `recover.py` `NOT_LISTED`, `DID_NOT_UNLOCK`; `test_root_readme.py` reads the constants |

### D6. Security review (2026-10-16)
- **Information disclosed by the new message.** It tells the local user that the key holds a credential listed in the
  copy, and that no entry authenticated. Credential IDs are public in every blob, and the key answers only to its
  holder with user verification, so nothing crosses a trust boundary that did not before. The exit code (7) and the
  absence of output are unchanged (`test_blob_file_with_wrong_vault_id_shows_nothing` still passes).
- **No plaintext path changes.** Only message strings move into constants; `_discover`, `_by_rp_ids`, `vault.py` and
  the wiping are untouched.
- **Social-engineering surface.** The message sends the user to `--vault-id` and to another enrolled key or source. It
  never tells the user to re-enter the PIN, to use a different site, or to pass `--rp-id`, so it cannot be used to
  steer a victim toward a phishing RP ID.
- **README accuracy.** Every claim has a source (D5). The README quotes the messages through the test, so a reworded
  message breaks CI rather than the documentation.
