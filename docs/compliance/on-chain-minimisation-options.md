# On-chain minimisation: options and costs

> `add-privacy-and-compliance` task 7.3 (design D3). An engineering paper: what each option would remove from the
> public record, what it would cost, and what it would break. Not a legal document. Inputs: `docs/spec/vault-format-v1.md`,
> `docs/reviews/on-chain-confidentiality-2026-10.md` (§1 inventory, F2, F3, F6), `docs/reviews/harden-gas-sponsorship.md`
> (N1), `contracts/GAS.md`, `apps/web/docs/costs.md`. Prepared 2026-10-08.

## What is public today, per vault

| Item | Where | Needed for |
|---|---|---|
| Ciphertext (payload, wrapped keys), `wrapSalt`, format header, RP ID | registry blob, Arweave item | decryption with a key |
| Credential ID per key (≤ 128 B, usually 64) | blob header | choosing the entry to unwrap; targeting a specific key in add-key and edit ceremonies |
| Locator per key | registry index, `LocatorAdded`, Arweave tag | finding the vault from a key alone (single tap, no CryoShield server) |
| P-256 public key per key | smart-account owners | verifying every WebAuthn signature on-chain |
| Smart-account address, vaultId, version, `blobHash` | registry, events | ownership and update checks |
| Every earlier blob version, block timestamps | chain history | inherent to a public chain |
| Size class (64-byte padding steps); removed by O3 (`pad-to-max-payload`, 2026-10-10) | blob length | nothing; the blob length now depends on public data only |

The identifiers that link a vault to a credential are therefore **three**: the credential ID, the locator and the
P-256 key. Removing one does not unlink anything while the other two remain.

## Options

### O1. Drop cleartext credential IDs from the blob header

- **Removes:** one stable per-credential identifier (64–128 B per key).
- **Feasible?** Yes, technically. Credentials are discoverable (`residentKey: "required"`), so an unlock needs no
  `allowCredentials`, and a client can trial-unwrap every entry (≤ 8 AES-GCM attempts, no extra tap). The recovery
  tool already does this when it has no credential ID (`vault.py` `_candidate_entries`).
- **Breaks or changes:**
  - the project rule "the vault format records the RP ID, PRF salts, **credential IDs** and algorithm IDs"
    (CLAUDE.md, `openspec/config.yaml`), which exists so recovery never depends on a key's discoverable-credential
    storage. A founder decision would have to change the rule first;
  - add-key and edit flows that target one key with `allowCredentials` (`apps/web/src/webauthn/index.ts`) would have
    to use a discoverable assertion and match by trial unwrap;
  - recovery from a key whose discoverable slot was overwritten or wiped would no longer be possible with only the
    credential handle.
- **Cost:** a new format version byte; TypeScript and Python encoders/decoders; new test vectors and both
  implementations re-checked against them; spec rewrite (§5, §6.5, §8); web unlock, add-key and edit flows; recovery
  tool; about 2–3 weeks of work across CE, FE and RE, plus a security review.
- **Gain:** small. The P-256 key (needed by the wallet) and the locator (needed for keyless lookup) are equally
  stable per-credential identifiers, and every vault already written keeps its credential IDs in its history forever.
  Side benefit: 64–128 B more payload capacity per key under the 1 KB cap, and slightly lower gas.
- **Recommendation:** **reject** for v1. Revisit only together with O2 and O5, if ever.

### O2. Unlinkable locators (a different locator per vault)

- **Removes:** the link between vaults opened by the same credential (review F6).
- **Feasible?** No, not without losing the product's core property. The locator must be computable from the PRF output
  alone, before any vault is known, so that one tap finds the vault with no server. A per-vault salt would have to be
  stored somewhere findable, which is the locator again.
- **Recommendation:** **reject.** Document the linkage (done on `/privacy`).

### O3. Fixed-size padding

- **Removes:** the size class (review F3: a 12-word and a 24-word seed phrase usually differ in length).
- **Feasible?** Yes: pad every payload to the largest size that fits the key count under the 1 KB cap.
- **Cost:** more calldata on every create and update. On OP Mainnet the L1 data fee dominates and is roughly linear in
  bytes; a 526-byte blob padded to ~1 KB about doubles that part of the fee (today's 1 KB create is estimated at about
  $0.03 at typical prices, `apps/web/docs/costs.md`). The sponsorship budget pays it. Format: the TypeScript decoder already
  accepts longer zero padding (`packages/vault-crypto/src/padding.ts` `unpad`), and payload v2's "Archive and clear"
  already writes extra padding; the Python decoder and spec §6.1's padded-length rule must be checked, and the encoder
  change needs new vectors.
- **Recommendation:** **decide before the first mainnet vault**, together with review F2 (payload-nonce derivation),
  because both are cheapest before any mainnet vault exists. Leaning accept: the cost is cents and it removes the
  one leak about the secret itself.

### O4. Drop the locator tags from Arweave items

- **Removes:** the second public copy of the locators.
- **Breaks:** chain-free recovery. The recovery tool finds vaults on Arweave by locator tag when no RPC is available.
- **Recommendation:** **reject.**

### O5. A fresh smart account per vault

- **Removes:** the shared account address between vaults that use the same keys (the account depends only on the
  owners and the nonce, review N1).
- **Cost:** one account deployment per vault (sponsored gas), a per-vault salt in the factory call, and more
  complexity in the edit and add-key flows.
- **Gain:** none while the P-256 keys and locators are shared anyway.
- **Recommendation:** **reject.**

## Summary

| Option | Removes | Cost | Breaks | Recommendation |
|---|---|---|---|---|
| O1 credential IDs | one of three per-key identifiers | format v2, both implementations, ~2–3 weeks | a project rule; history keeps old IDs | reject |
| O2 per-vault locators | vault ↔ vault linkage | n/a | single-tap keyless lookup | reject |
| O3 fixed padding | size class | ~cents per write | nothing | decide before the first mainnet vault (lean accept) |
| O4 no Arweave locator tags | duplicate locators | small | chain-free recovery | reject |
| O5 per-vault accounts | shared account address | gas per vault | nothing | reject |

**Decision record.** Proposed by the maintainers on 2026-10-08 and entered in the PRD decisions log ("On-chain
minimisation"). O3 needs its own OpenSpec change if accepted.

**O3 accepted (founder, 2026-10-10, mainnet-gate review):** OpenSpec change `pad-to-max-payload` pads every payload to
`64 × floor((1024 − overhead) / 64)` bytes, keeping version 0x01. A 2-key vault with 64-byte credential IDs is now
974 bytes whatever it holds (was 526 for a 12-word and 590 for a 24-word seed). Measured cost: about $0.0003 more per
edit and $0.001 more per create (`apps/web/docs/costs.md`). F2 stays open and separate (that change's design D6).
