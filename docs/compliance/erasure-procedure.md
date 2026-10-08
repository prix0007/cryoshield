# Erasure procedure

> `add-privacy-and-compliance` task 6.3, design D3; spec `privacy-compliance` "Erasure request handling". CryoShield is
> an open-source project maintained by its contributors; there is no company. Not legal advice.

The honest summary: **CryoShield holds almost nothing, so there is almost nothing it can delete. Data published on the
blockchain and Arweave cannot be deleted by anyone.** What a user *can* do is make their vault permanently unreadable
by destroying their keys.

## 1. What can be deleted

| Data | Who deletes it | How |
|---|---|---|
| Privacy-request issues, comments and PR text the person posted | maintainer (or the author) | delete the issue (or redact the comment) on GitHub. Edit history of a public issue stays visible, so deleting the whole issue is preferred when it holds personal data |
| Private security advisories | maintainer | close once handled; delete at most 3 years after closure (`retention.md`) |
| Anything in the user's own browser | the user | no cookies; the only stored item is the optional theme choice (`localStorage` `cryoshield-theme` = `light` or `dark`, set only when the user picks it, never sent anywhere), removed by choosing System in the Theme menu or by clearing the site's data in the browser; closing the tab clears the open vault from memory (it also locks after 5 minutes idle) |
| Downloaded encrypted backup files (`cryoshield-<id>.cryo`) | the user | delete the file. It is ciphertext only, the same bytes as on-chain |
| Vendor logs (Fly, Pimlico, RPCs, Turbo/ar.io, Cloudflare) | each vendor | under the vendor's own policy. The maintainers cannot see or delete them; the user can ask the vendor directly (links in `subprocessors.md`) |
| The user's keys (and with them the ability to decrypt) | the user | see §3, crypto-shredding |

## 2. What cannot be deleted

By anyone, including the maintainers, the chain's operators and the user:

- the encrypted vault blob and **every earlier version** of it, on the chain and on Arweave;
- the smart-account address, the vaultId, the locators, the credential IDs, each key's P-256 public key and the
  block timestamps;
- the Arweave data items and their tags (`CryoShield-Vault-Id`, `-Version`, `-Locator`) and the upload address.

An Arweave gateway may hide an item from its own responses, but the network keeps it. The registry contracts have no
admin and no delete function, by design.

## 3. Making a vault permanently unreadable (crypto-shredding)

Checked against `docs/spec/vault-format-v1.md` (§3, §4, §6.3): each enrolled key's wrapping key is
`HKDF(PRF output, wrapSalt)`, and the PRF output is the authenticator's hmac-secret for that credential, which only the
security key can compute, and only after its PIN. The published blob holds only `wrapSalt` and the wrapped data key, so
**once every enrolled credential is gone, no wrapping key can be derived, and the AES-256-GCM ciphertext cannot be
decrypted by any known technique.**

Steps for the user:

1. List every key enrolled for the vault (any one of them opens it; for a Shamir vault, keep the destroyed count
   above N − M, and simplest is all of them).
2. For each YubiKey: `ykman fido reset` (or Yubico Authenticator → Passkeys → Reset). **This erases every passkey and
   FIDO2 credential on that key, for every website, not only CryoShield.** It must be done within a few seconds of
   inserting the key. Other authenticators have an equivalent "reset FIDO" function; physically destroying the key
   also works.
3. Delete any `.cryo` backup files, and anything else where the secrets were written down.
4. If the secret itself (a seed phrase, recovery codes) matters, **move it**: create a new wallet seed or regenerate
   the codes. Crypto-shredding protects the published copy; it does not undo a past exposure (review F1).

Deleting only the CryoShield credential (`ykman fido credentials delete`) removes it from the key's list, but we do not
claim that it destroys the hmac-secret on every authenticator; use the full reset or destruction.

**What crypto-shredding is not.** It is not erasure. The ciphertext and the identifiers in §2 stay public forever. The
ciphertext stays unreadable as long as AES-256-GCM and HKDF-SHA256 hold (no known attack, including known quantum
attacks, which leave about 128-bit security). The identifiers name no person; once the user stops using that vault and
its keys, they point to nothing the user still uses.

## 4. Handling a request

| Step | Target |
|---|---|
| Acknowledge (comment on the issue or advisory) | within **24 hours** |
| Reply with what was deleted, what cannot be, and the crypto-shredding steps | within **15 days** |

1. **Never ask for, accept or act on secrets, seed phrases, recovery codes, PINs or keys.** The maintainers cannot act
   on a vault and never claim to. If the request contains any of these, delete the issue at once and say why in a new
   one or in the advisory.
2. If the request is a public issue that contains personal data (an account address, a name), ask whether to move it
   to a private advisory, then delete or redact the issue.
3. Delete what §1 lists as ours. Do not try to verify identity: we hold nothing that could be linked to a person, so
   there is nothing to protect by verifying.
4. Reply with the template below. Close the issue or advisory.
5. Note the request (date, channel, outcome, no personal data) in the next `review-log.md` entry.

### Reply template

> Thanks for your request. Here is what we did and what we can't do.
>
> **Deleted:** [this issue / the advisory content / nothing else: CryoShield keeps no accounts, cookies or server
> logs].
>
> **Can't be deleted by anyone:** your encrypted vault and its public details (account address, vault ID, locators,
> credential IDs, key public keys, save times) on the blockchain and Arweave. Blockchains and Arweave are built so
> that nothing written can be removed.
>
> **How to make your vault permanently unreadable:** reset or destroy every security key enrolled for it (for a
> YubiKey: `ykman fido reset`; this erases all passkeys on that key, for every website). Without the keys, nobody can
> decrypt the vault. If the secret itself matters, move it (new seed phrase, new recovery codes).
>
> **Other services:** hosting, the fee sponsor, blockchain access and Arweave services keep their own logs; you can ask
> them directly: [links from subprocessors.md].
>
> We will never ask for your secrets, keys or PIN.

## 5. Checks

- **Crypto-shredding statement vs the format spec:** matches `docs/spec/vault-format-v1.md` §4 (wrap key from the PRF
  output and `wrapSalt` only) and §9 (PRF outputs never persisted or sent). Checked 2026-10-08.
- **Desktop recovery tool sends no telemetry:** all network access goes through `tools/recover/src/cryoshield_recover/net.py`,
  whose `request` is called only from `rpc.py` and `arweave.py` (chain and Arweave reads to the chosen endpoints);
  `cli.py` uses only its URL-validation helpers, and no other module imports `urllib.request`, `socket` or `http.client` (`chain.py` uses only `urllib.parse`).
  Checked 2026-10-08.
