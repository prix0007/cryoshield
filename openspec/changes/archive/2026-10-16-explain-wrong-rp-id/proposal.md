# Proposal

## Why

Two gaps remain after `readme-threat-model-and-drill` (#109, issue #107), raised in the founder's review of that
work:

1. **The salt mapping has no line of its own.** The README says python-fido2 "maps the PRF input to the CTAP2 salt
   exactly as browsers do" but never says what the mapping is. A browser's PRF extension hashes its input,
   `SHA-256("WebAuthn PRF" || 0x00 || input)`, before the key sees it, so a client talking CTAP2 `hmac-secret`
   directly must do the same. Sending the input unhashed returns a different value that opens nothing. That is the
   detail most direct reimplementations get wrong, and the README is where a reader checking the recovery story
   looks first.
2. **A wrong RP ID must not look like a bad key.** The concern: a wrong RP ID silently yields a different PRF
   output, and the failure then surfaces as an opaque decrypt error that looks like a bad key. In this tool it does
   not, but the README does not say so, and one message could name its cause. In the discovery path the key refuses
   a name it holds no credential for, and the tool's message names `--rp-id`. With `--vault-id` or `--blob-file` the
   RP ID is read from the vault's own header. And the format already has a key check before the ciphertext: the data
   key is wrapped once per credential under AES-256-GCM (vault-format-v1 §5), the tool matches the entry by the
   credential ID the key answered with (`vault.py` `_candidate_entries`), and that wrap's authentication tag is
   verified before the payload is read. The one message on that path, "The key did not unlock that vault.", does not
   say what to check: for a saved file, the `--vault-id`, which the wrap binds.

No vault-format change is needed. A separate key-check value would duplicate the per-credential wrap tag, and the
v1 format is frozen public ciphertext.

## What Changes

- **README.md**, "Your vault is bound to the name `cryoshield.app`" subsection:
  - a paragraph that states the single PRF input, the second hash a CTAP2 client must apply, where the tool does it
    (`derive.py`), the specification section and the vectors that carry both salts;
  - a paragraph "A wrong RP ID does not look like a bad key": the named failure for a name the key holds no credential
    for, the RP ID read from the vault's own header for `--vault-id` and `--blob-file`, the per-credential wrap tag as
    the key check, and the two distinct messages, quoted from the tool.
- **tools/recover** (`recover.py`): the messages of the known-identifier path become module constants. The "did not
  unlock" one says the key is listed in that vault, names `--vault-id` as the thing to check for a file, and says the
  copy may otherwise be damaged. Exit codes and flags are unchanged.
- **tools/recover/README.md**: a troubleshooting entry for that message.
- **Tests, written first:** `test_root_readme.py` asserts the formula, the locator-salt input, the spec anchor and
  that the quoted messages are the tool's constants; `test_vault_id_binding.py` asserts that a wrong vault ID for a
  file produces the message naming `--vault-id`; `test_recover.py` asserts that a key not listed in the vault gets the
  other message.

## Out of scope

- Any change to the vault format, the PRF input, the derivation, exit codes or flags.
- The discovery-path messages, which already name `--rp-id`.
- The website's copy and `llms.txt`.

## Runtime dependencies

None. The change adds documentation, three message constants and tests. It adds no runtime piece and no
CryoShield-operated backend.

## Capabilities

### Modified Capabilities
- `project-readme`: the RP ID requirement also covers the salt mapping and the wrong-RP-ID explanation.
- `vault-recovery`: a listed key that does not unlock a vault gets a message naming the cause to check, distinct from
  the message for a key that is not listed.

## Impact

- **Changed:** `README.md`, `tools/recover/src/cryoshield_recover/recover.py` (messages only),
  `tools/recover/README.md`, `tools/recover/tests/test_root_readme.py`, `tools/recover/tests/test_vault_id_binding.py`,
  `tools/recover/tests/test_recover.py`.
- **CI:** the `recover` job runs, since `tools/recover/**` changes.
