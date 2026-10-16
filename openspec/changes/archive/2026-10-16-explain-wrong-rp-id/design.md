# Design

## Decisions

### D1. No key-check value: the per-credential wrap tag is one
A key-check value (a MAC of a fixed string under the derived key) would let a tool say "the key answered but the
derived key does not match" before touching the ciphertext. The v1 format already provides exactly that: the data key
(or, in a Shamir vault, a 33-byte share of it) is wrapped once per enrolled credential with AES-256-GCM
(`vault-format-v1.md` §5), each entry carries its credential ID, and the wrap's additional data binds the vault ID, the entry index, the RP ID and the wrap salt (§6). The
recovery tool matches the entry by the credential ID in the assertion (`vault.py` `_candidate_entries`) and verifies
that 48-byte wrap (49 bytes for a Shamir share) first; the payload is read only after a wrap authenticates. A separate check value would add bytes to
a frozen public format for no new information, so this change documents the check instead of adding one.

### D2. Where a wrong RP ID surfaces, path by path
| Path | What a wrong RP ID does | Message |
|---|---|---|
| Discovery (no identifier), key holds no credential for the name | the key returns no credential; no PRF output exists | `NO_DISCOVERABLE_CREDENTIAL`, which names `--rp-id` |
| Discovery, key holds a credential for the other name too (enrolled on the live and the development site) | a different PRF output, so a different locator; the other site's vaults or none are found | the existing "No vault unlocked with this key" message, which names `--rp-id` and `--network` |
| `--vault-id` / `--blob-file` | the RP ID is read from the vault's own header; `--rp-id` is only used when a found copy records it (`_rp_id_order`) | n/a: the name cannot be mistyped on this path |
| `--blob-file` with a wrong `--vault-id` | the wrap's additional data binds the vault ID, so no entry authenticates although the key answered | `DID_NOT_UNLOCK`, new wording: names `--vault-id` |
| `--vault-id` for a vault the key is not listed in | the allow list holds no credential the key has | "This key has no credential for '<rp>'." for each RP ID tried, then `NOT_LISTED` |
| `--vault-id` for a vault created on the other site (key enrolled on one site only) | the key has no credential for the RP ID in the vault's header; from the client side this is the same outcome as the row above | the same two lines: the first names the site, so the user sees which site the vault belongs to |

### D3. "Listed", not "enrolled"
The key answering an allow-list assertion proves that the key holds a credential whose ID the copy lists. Credential
IDs are public, so an attacker-tagged Arweave copy can list a victim's credential IDs over junk wrapped keys. The
message therefore says "listed in that vault", and its second cause is a damaged copy, with the advice to try another
enrolled key or another source. The README uses the same word. The allow list of an RP group is the union of the
credential IDs of every copy in it, so a key matching only a junk copy also reaches this message; "may be damaged;
try another source" covers that case, and the message deliberately stays short rather than saying "a copy of".

The other message, `NOT_LISTED`, covers every case in which no RP ID tried produced an assertion: a key whose
credentials the copies do not list, and a key with no credential for the vault's site at all (enrolled only on the
other site). A CTAP2 client cannot tell those apart. The line printed just before, "This key has no credential for
'<rp>'.", names the site, so the message says "for the site named above".

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
| The data key (or a Shamir share) is wrapped per credential under AES-256-GCM, 48 or 49 bytes, matched by credential ID when the key reports one (every entry otherwise), checked before the payload | `vault-format-v1.md` §5 (`wrapped` 48 / 49), §6; `vault.py` `_candidate_entries` (`cred_id is None` branch), `_unwrap`, `_data_key` |
| `--rp-id` should only ever be the exact name the vault was created under | the README's guardrail (ECC review of b928f20) |
| The wrap binds the vault ID | `vault-format-v1.md` §6 (`wrapAad` includes `vaultId`); `vault-recovery` "Candidates are opened under their own vault ID" |
| The two quoted messages are the tool's | `recover.py` `NOT_LISTED`, `DID_NOT_UNLOCK`; `test_root_readme.py` reads the constants |

### D6. Security review (2026-10-16)
- **Information disclosed by the new message.** It tells the local user that the key holds a credential listed in the
  copy, and that no entry authenticated. Credential IDs are public in every blob, and the key answers only to its
  holder with user verification, so nothing crosses a trust boundary that did not before. The exit code (7) and the
  absence of output are unchanged (`test_blob_file_with_wrong_vault_id_shows_nothing` still passes).
- **No plaintext path changes.** Only message strings change: `_discover` and `_by_rp_ids` raise the same exit codes
  with the new constants, and `vault.py` and the wiping are untouched.
- **Social-engineering surface.** The message sends the user to `--vault-id` and to another enrolled key or source. It
  never tells the user to re-enter the PIN, to use a different site, or to pass `--rp-id`, so it cannot be used to
  steer a victim toward a phishing RP ID.
- **README accuracy.** Every claim has a source (D5). The README quotes the messages through the test, so a reworded
  message breaks CI rather than the documentation.

### D7. ECC review follow-ups (review of b928f20, 0 blocking, 8 advisory)
All applied except the last, which was optional: the README and D1/D5 say the wrap holds the data key or a Shamir
share and is 48 or 49 bytes; `NOT_LISTED` now covers a key with no credential for the vault's site and points at the
line naming the site (D2, D3); the README mentions the try-every-entry fallback; the spec delta and the tool README say
"the vault did not open" rather than "no wrapped key authenticated", since `DID_NOT_UNLOCK` also follows a payload
failure; the README tests pin each quoted sentence with its quote marks and period, check the `--rp-id` and
`--vault-id` hints in the constants themselves, scope the assertions to the paragraph, and use `partition` with an
assertion; D6 no longer says "untouched"; the README tells readers to use `--rp-id` only with the exact name the vault
was created under. The "a copy of that vault" wording was not adopted (D3 explains the union allow list instead).
