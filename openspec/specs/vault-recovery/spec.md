# vault-recovery Specification

## Purpose
Lets a user recover and decrypt a CryoShield vault with only an enrolled FIDO2 hardware key and public infrastructure (public chain RPCs and Arweave gateways), without the CryoShield website, domain, or any CryoShield-operated service.

## Requirements

### Requirement: Infrastructure independence
The recovery tool SHALL complete a recovery without contacting any CryoShield-operated host or domain. Its only network traffic SHALL be read-only JSON-RPC calls to public chain endpoints and reads from Arweave gateways. It MUST NOT send transactions, PRF outputs, derived keys, or plaintext over the network.

#### Scenario: CryoShield offline
- **WHEN** every CryoShield domain is unreachable and the user runs a recovery with an enrolled key
- **THEN** the vault is located, decrypted, and shown using only public RPC and Arweave endpoints

#### Scenario: No secret material on the wire
- **WHEN** the tool's network traffic during a recovery is captured in the integration test
- **THEN** it contains only `eth_chainId`, `eth_call`, `eth_getLogs`, GraphQL queries, and gateway GETs, and no PRF output, derived key, or plaintext bytes

### Requirement: Built-in defaults with overrides
The tool SHALL ship with a built-in RP ID, registry address, chain ID, a list of at least three independent public RPC endpoints, and at least two Arweave GraphQL/gateway endpoints. Every one of these SHALL be overridable by a command-line flag, without editing code.

#### Scenario: Override registry and RPC
- **WHEN** the user passes `--rpc <url>` (repeatable), `--registry <address>`, and `--rp-id <id>`
- **THEN** the tool uses only those values and reports them in its startup summary

#### Scenario: Defaults used
- **WHEN** the user passes no overrides
- **THEN** the tool uses the built-in defaults and prints which endpoints it will contact before contacting any

### Requirement: CTAP2 PRF evaluation
The tool SHALL obtain each credential's PRF output via CTAP2 `hmac-secret`, with salt = SHA-256("WebAuthn PRF" || 0x00 || SHA-256("cryoshield/v1/locator-salt")) as defined by `vault-crypto`, and with user verification (PIN or built-in UV) always performed, so the output equals the browser's PRF output. It MUST NOT request a second salt.

#### Scenario: CTAP salt matches vectors
- **WHEN** the tool computes its hmac-secret salt
- **THEN** it equals the CTAP-salt field in `packages/vault-crypto/test-vectors/v1.json`

#### Scenario: Same output as the browser
- **WHEN** a credential created and evaluated by the web app with user verification is evaluated by the tool on the same key
- **THEN** both produce the same locator, and the tool decrypts the web-created vault

#### Scenario: Key without hmac-secret
- **WHEN** the connected authenticator does not advertise `hmac-secret`
- **THEN** the tool stops with a message saying the key is unsupported (e.g. YubiKey firmware below 5.2), and nothing is decrypted

### Requirement: Keyless discovery via discoverable credentials
Without user-supplied identifiers, the tool SHALL request an assertion for the RP ID with an empty allow list. It SHALL obtain a PRF output for every discoverable credential the key returns from that one ceremony, and SHALL derive one locator per credential.

#### Scenario: One credential on the key
- **WHEN** the key holds one discoverable CryoShield credential and the user taps once and enters the PIN
- **THEN** the tool derives that credential's locator and proceeds to lookup

#### Scenario: Several credentials on the key
- **WHEN** the key holds several discoverable credentials for the RP ID
- **THEN** the tool derives a locator for each from the same ceremony, without another tap, and tries all of them

#### Scenario: No discoverable credential
- **WHEN** the key returns no credential for the RP ID
- **THEN** the tool explains that the key has no discoverable CryoShield credential and how to recover by `--vault-id`, `--credential-id`, or `--blob-file`

### Requirement: Recovery with known identifiers
The tool SHALL accept `--vault-id`, `--credential-id` (repeatable), and `--blob-file`. With a vault ID or blob file, it SHALL read the candidate blobs first and use their recorded credential IDs as the allow list. With a credential ID, it SHALL use that ID as the allow list. When every candidate shares one RP ID, either path SHALL need only one tap.

#### Scenario: Recover by vault ID
- **WHEN** the user passes `--vault-id` for a vault whose credentials are not discoverable
- **THEN** the tool fetches the blob, builds the allow list from its credential IDs, takes one tap, and decrypts

#### Scenario: Recover from a saved blob, fully offline
- **WHEN** the user passes `--blob-file`, its `--vault-id`, and `--offline`
- **THEN** the tool makes no network request and decrypts using the key alone

#### Scenario: Saved blob without a vault ID
- **WHEN** the user passes `--blob-file` without `--vault-id`
- **THEN** the tool exits with a usage error explaining that a vault only decrypts under the vault ID it was registered under, and no ceremony takes place

#### Scenario: Blob RP ID differs from configured RP ID
- **WHEN** the blob's recorded RP ID differs from the configured RP ID
- **THEN** the tool uses the blob's RP ID for the ceremony and tells the user it did so

### Requirement: Safe RP ID choice for known-identifier recovery
Candidate RP IDs are attacker-influenced, since anyone can tag an Arweave transaction with a victim's vault ID. The tool SHALL try distinct RP IDs in this order:
1. the configured RP ID;
2. RP IDs of on-chain copies;
3. the RP ID of the user's file;
4. Arweave copies.

It SHALL announce each non-configured RP ID and SHALL try at most 3.

#### Scenario: Attacker-tagged Arweave copy with a foreign RP ID
- **WHEN** `--vault-id` finds a genuine copy for the configured RP ID and a newer Arweave copy tagged with the same vault ID but created for another RP ID
- **THEN** the first ceremony uses the configured RP ID and the genuine vault is recovered

#### Scenario: First RP ID has no credential
- **WHEN** the key has no credential for the first RP ID tried
- **THEN** the tool says so and tries the next RP ID

### Requirement: Chain lookup through public RPCs
For each locator, the tool SHALL call the registry's `resolveLocator` and then `getVault` for each candidate using `eth_call`. It SHALL query at least two configured RPCs when available and take the union of their candidates. It SHALL reject any RPC whose `eth_chainId` differs from the configured chain ID.

#### Scenario: Candidates resolved
- **WHEN** a locator is registered on-chain
- **THEN** the tool retrieves every candidate `vaultId` and its blob without sending a transaction

#### Scenario: Wrong chain endpoint
- **WHEN** a configured RPC reports a chain ID other than the configured one
- **THEN** that RPC is ignored with a warning and its answers are not used

#### Scenario: One RPC withholds results
- **WHEN** one RPC returns an empty candidate list and another returns the genuine vault
- **THEN** the genuine vault is still found

### Requirement: Hostile responses are contained
Any failure to parse or interpret a response from one RPC, GraphQL server, or gateway SHALL be confined to that source. This includes deeply nested JSON, non-finite numbers (NaN, Infinity, 1e999), oversized integers, invalid encodings, and unexpected types. The source SHALL be discarded with a warning, and recovery SHALL continue with the other sources.

#### Scenario: Deeply nested JSON
- **WHEN** one RPC answers with `[` repeated 60,000 times (under the size cap) and another RPC answers correctly
- **THEN** the hostile answer is discarded with a warning and the vault is recovered

#### Scenario: Non-finite size from GraphQL
- **WHEN** one GraphQL server reports a transaction size of `Infinity` or `NaN`
- **THEN** that entry is ignored and a genuine transaction from another server is still found and fetched

### Requirement: Whole-request deadline
Every HTTP request SHALL be bounded both by a per-read timeout and by a deadline for the whole request, so that a server trickling bytes cannot stall recovery.

#### Scenario: Trickling server
- **WHEN** a server sends one byte every 100 ms with a 0.5 s timeout configured
- **THEN** the request fails with a deadline error within about 1.5 s

### Requirement: Remote text is made inert
Before any text from a remote source is printed, the tool SHALL remove control characters, ANSI/OSC escape introducers, and Unicode format characters from it. Remote text includes error messages, transaction IDs, and host-reported values. Newlines and tabs are kept.

#### Scenario: Escape sequence in an RPC error
- **WHEN** an RPC returns an error message containing `ESC ] 0 ; … BEL` and `ESC [ 2 J`
- **THEN** the terminal output contains no ESC or BEL bytes, and the message text is shown inertly

### Requirement: Disagreeing chain sources
When RPCs return different blobs for the same vault ID, the tool SHALL compare each blob's keccak256 with the latest `VaultCreated`/`VaultUpdated` hash. It SHALL keep "current" only for a matching blob and demote the others. It SHALL warn visibly in every case. If the history cannot be confirmed, it SHALL mark the copies unverifiable and SHALL apply the support-based ranking and explicit-choice rules of `harden-recovery-network-trust`; it never prefers a self-reported version.

#### Scenario: One RPC serves a stale genuine blob
- **WHEN** the first RPC serves version 1 of a vault and another serves version 2, and the event history agrees that version 2 is latest
- **THEN** version 2 is shown as current, version 1 is demoted, and a security warning is printed

#### Scenario: Lagging node with stale history
- **WHEN** RPCs disagree on both the blob and the event history
- **THEN** the history is treated as unverifiable, the copy returned by more servers is preferred (on a tie the user must choose explicitly), and the user is warned that it may not be the latest

### Requirement: ABI decoding is bounded
The tool SHALL decode RPC responses defensively: it MUST bounds-check every ABI offset and length, reject blobs over 1024 bytes and candidate lists over 16 entries, and treat malformed responses as an RPC failure rather than crashing.

#### Scenario: Malicious RPC response
- **WHEN** an RPC returns an ABI payload with out-of-range offsets or a 1 MB blob length
- **THEN** that response is discarded with a warning and recovery continues with other sources

### Requirement: Arweave fallback
When no RPC is usable, or no on-chain candidate authenticates, the tool SHALL query Arweave GraphQL for transactions tagged `App-Name: CryoShield` and `CryoShield-Locator: <lowercase 0x-prefixed hex locator>`, fetch each transaction's data from a gateway, and treat each blob as a candidate.

#### Scenario: Chain unreachable
- **WHEN** every RPC fails and the vault is mirrored to Arweave
- **THEN** the tool finds the blob through GraphQL, decrypts it, and states that the result came from Arweave

#### Scenario: Oversized Arweave data
- **WHEN** a tagged transaction's data exceeds 1024 bytes
- **THEN** it is skipped without being fully downloaded

### Requirement: Arweave integrity against chain events
When a chain RPC is reachable, the tool SHALL compare `keccak256` of each Arweave blob with the hashes in the registry's `VaultCreated`/`VaultUpdated` events for that `vaultId`. It SHALL report whether the blob is verified, outdated, unmatched, or unverifiable, and SHALL prefer the on-chain current blob when both authenticate. The event history counts only when at least two usable RPCs (or the only one configured) return identical histories; otherwise it is unverifiable.

#### Scenario: Hash matches the latest event
- **WHEN** an Arweave blob's keccak256 equals the latest event hash for its vault
- **THEN** the tool reports it as verified and current

#### Scenario: Older version
- **WHEN** the hash matches an earlier event but not the latest
- **THEN** the tool decrypts it but warns that a newer version exists on-chain

#### Scenario: No chain available
- **WHEN** no RPC is reachable
- **THEN** the tool relies on AES-GCM authentication alone and warns that freshness could not be verified

#### Scenario: RPC histories disagree
- **WHEN** two RPCs return different event histories for the vault
- **THEN** the copy is reported as unverifiable (never verified, never unmatched) and a warning is printed

### Requirement: Format v1 conformance
The tool SHALL implement vault format v1 decoding, locator and wrap-key derivation, unwrapping, and payload decryption for modes 0x01 and 0x02, as specified by `vault-crypto`. It MUST pass every positive and negative case in `packages/vault-crypto/test-vectors/v1.json`. A disagreement with the vectors MUST be reported, never patched over.

#### Scenario: All vectors pass
- **WHEN** the test suite runs against `v1.json`
- **THEN** every positive vector reproduces the expected locator, wrap key, and plaintext, and every negative vector yields its specified error class

#### Scenario: Vector file missing or changed
- **WHEN** `v1.json` is absent or its recorded SHA-256 differs from the pinned value in the tool's tests
- **THEN** the test suite fails, rather than skipping, until the pin is consciously updated

### Requirement: Candidates are opened under their own vault ID
Following vault-format-v1 §4.1, each candidate SHALL be opened under the vault ID it was found under, and that vault ID SHALL never come from the blob or its neighbouring data:
- the registry vault ID, for chain copies;
- the exact `CryoShield-Vault-Id` tag value, for Arweave copies;
- `--vault-id`, for a file.

Copies without a valid vault ID SHALL be ignored. Candidates SHALL be distinguished by (vault ID, blob), so a byte-identical clone never replaces the genuine copy.

#### Scenario: Clone listed before the genuine vault
- **WHEN** a locator resolves first to an attacker's vault ID holding a byte-identical copy of the victim's blob, then to the victim's vault ID
- **THEN** the clone fails authentication and is ignored, and the genuine vault is recovered and reported with its own vault ID

#### Scenario: Only a clone exists
- **WHEN** the only copies found are clones under other vault IDs (on-chain or Arweave-tagged), even with their own consistent event history
- **THEN** recovery fails with "no matching vault" and no plaintext is shown

#### Scenario: Wrong vault ID for a file
- **WHEN** `--blob-file` is used with a vault ID other than the one the blob was created for
- **THEN** no plaintext is shown

### Requirement: Candidate selection
Given all candidates from every source and every derived PRF output, the tool SHALL select the candidates whose wrapped key authenticates. If several authenticate, it SHALL prefer the on-chain current blob, then the latest verified Arweave blob. Junk and malformed candidates SHALL be ignored silently, except for a count.

#### Scenario: Squatted locator
- **WHEN** a locator resolves to the genuine vault plus junk blobs, as in the candidate-list vector
- **THEN** the tool selects the genuine vault and reports how many candidates it ignored

#### Scenario: Nothing authenticates
- **WHEN** no candidate authenticates under any derived key
- **THEN** the tool reports "no matching vault" with next steps and shows no plaintext

### Requirement: Shamir multi-key recovery
For a mode 0x02 vault, the tool SHALL prompt the user to tap additional enrolled keys one at a time until it holds M shares, and SHALL then reconstruct the data key compatibly with the `vault-crypto` share encoding.

#### Scenario: Two of three keys
- **WHEN** a 2-of-3 vault is recovered by tapping two different enrolled keys
- **THEN** the secret is decrypted and matches the 2-of-3 vector behaviour

#### Scenario: Same key tapped twice
- **WHEN** the user taps a key whose share is already held
- **THEN** the tool says so and asks for a different key

### Requirement: Explicit confirmation before showing secrets
The tool SHALL NOT print plaintext until the user explicitly confirms at an interactive prompt after a warning about shoulder-surfing and screen capture. `--output <file>` SHALL instead write the plaintext to a new file with owner-only permissions. In non-interactive mode without `--output`, it SHALL refuse to print.

#### Scenario: User declines
- **WHEN** the user answers anything other than the confirmation word
- **THEN** no plaintext is printed and the tool exits successfully after zeroizing secrets

#### Scenario: Piped output
- **WHEN** stdin or stdout is not a terminal and `--output` is not given
- **THEN** the tool refuses to print the secret and explains `--output`

#### Scenario: Output file
- **WHEN** `--output secrets.txt` is given and the file does not exist
- **THEN** the plaintext is written with mode 0600 (or the platform equivalent), and an existing file is never overwritten

### Requirement: Secret hygiene in process
The tool SHALL keep PRF outputs, derived keys, and plaintext in mutable buffers, overwrite them after use on both success and failure, and never write them to logs, tracebacks, temporary files, or verbose/debug output.

#### Scenario: Debug mode
- **WHEN** the tool runs with `--verbose` through a full recovery
- **THEN** the captured log output contains no PRF output, derived key, PIN, or plaintext bytes

#### Scenario: Crash path
- **WHEN** an unexpected exception occurs after the PRF output was obtained
- **THEN** the buffers are zeroized and the error shown contains no secret values

### Requirement: Clear guidance for non-technical users
Every user-facing failure SHALL produce a plain-language message with a next step, and SHALL exit with a documented non-zero exit code. Failures covered include: no key found, wrong PIN, PIN blocked, no credential, network unavailable, no matching vault, and unsupported key.

#### Scenario: Wrong PIN
- **WHEN** the user enters a wrong PIN
- **THEN** the tool shows the remaining retries and lets the user try again without restarting

#### Scenario: No key connected
- **WHEN** no FIDO2 device is found over USB or NFC
- **THEN** the tool asks the user to insert or tap the key and, on Linux, points to the udev permission instructions

### Requirement: Installable and reproducible distribution
The tool SHALL be installable with `pipx install` and runnable with `uvx`. Single-file executables SHALL be built reproducibly from a hash-locked lockfile, so that two clean builds of the same commit on the same platform produce identical SHA-256 hashes. Those hashes SHALL be published with each release.

#### Scenario: uvx run
- **WHEN** a user with only uv installed runs `uvx cryoshield-recover --version` (from PyPI or `--from git+<repo>`)
- **THEN** the tool runs and prints its version and the format versions it supports

#### Scenario: Reproducible build
- **WHEN** CI builds the Linux single-file executable twice from the same commit in clean environments
- **THEN** both artifacts have the same SHA-256

### Requirement: On-chain state quorum
The tool SHALL treat RPC URLs that normalise to the same endpoint as one source. It SHALL mark a chain copy `current` only when at least `min(2, distinct configured RPCs)` RPCs return that exact blob for its vault ID and no RPC returns a different blob for it. Otherwise the copy's freshness SHALL come only from the agreed event history, and SHALL be `unverifiable` without one.

#### Scenario: Liar is the sole answering RPC
- **WHEN** three RPCs are configured, two fail, and the third returns an older genuine blob
- **THEN** that copy is labelled unverifiable (never current) and a warning is shown

#### Scenario: Duplicate URLs counted once
- **WHEN** the same RPC URL is configured twice (differing only in case or a trailing slash) and it returns a blob
- **THEN** it counts as one source, and the copy does not reach a quorum of 2 from that RPC alone

### Requirement: Ranking ignores self-reported versions
The tool SHALL NOT rank candidates by a version reported by an RPC or an Arweave tag. Within a freshness class, it SHALL prefer the copy returned by more independent sources, then the newer Arweave block height.

#### Scenario: One liar of three inflates the version
- **WHEN** two RPCs return the current blob and one returns an older genuine blob claiming version 2^32−1 together with a truncated history
- **THEN** the current blob is selected and a warning about disagreeing servers is shown

### Requirement: Explicit choice on unresolvable ties
For any vault, including threshold (Shamir) vaults: when the selected copy is not chain-verified and a different blob for the same vault ID also decrypts with equal rank, or with the same freshness when either copy comes from Arweave (where support and height are server-controlled), the tool SHALL warn and ask the user to choose explicitly. When an Arweave search was cut short by a budget and the selected copy is not chain-verified, the tool SHALL warn and ask for explicit confirmation. Before the choice it SHALL show only neutral public metadata (sources, support count, and status), never plaintext and never an RPC- or tag-claimed version, which is attacker-writable and could nudge the user toward an older copy. A non-interactive run SHALL exit with code 12 (`AMBIGUOUS`) and show no plaintext.

#### Scenario: Shamir vault tie
- **WHEN** a 2-of-3 vault's two configured RPCs return different decrypting copies and no agreed history exists
- **THEN** after the keys are collected, the user is asked to choose; a non-interactive run exits with code 12

#### Scenario: Download budget cut short
- **WHEN** the chain is unreachable and more tagged Arweave transactions exist than the download budget allows
- **THEN** the original mirror is still downloaded, and the user must explicitly confirm the unverified copy

#### Scenario: Two RPCs disagree equally
- **WHEN** two configured RPCs return different decrypting copies and no agreed history exists
- **THEN** the user is asked to choose a copy, and the chosen copy is the one shown

#### Scenario: Non-interactive tie
- **WHEN** the same tie occurs with `--output` in a non-interactive run
- **THEN** the tool exits with code 12 and writes nothing

### Requirement: Arweave records are per server
Each GraphQL server's record for a transaction SHALL be a separate candidate; metadata from one server SHALL NOT replace another's. Claimed sizes SHALL NOT decide whether data is downloaded (downloads stay capped at 1024 bytes). Each record's vault ID SHALL come from that server's own tag.

#### Scenario: Hostile server claims size 0 for the genuine transaction
- **WHEN** one server reports the genuine transaction with size 0 and another reports it correctly, in either order
- **THEN** the genuine blob is downloaded and recovered

#### Scenario: Hostile server relabels the vault ID
- **WHEN** one server reports the genuine transaction with another vault ID tag
- **THEN** the honest server's record still yields the genuine candidate under the genuine vault ID

### Requirement: Arweave search is paged and bounded
The tool SHALL query GraphQL servers in parallel, each within its own time budget, with every request's timeout clamped to that budget. Per server it SHALL fetch the oldest page first, then follow cursors newest-first within a page budget, and warn when that budget ends with results still pending. Downloads SHALL be bounded by a count and time budget, interleaved across servers, alternating each server's oldest and newest records.

#### Scenario: Slow first server
- **WHEN** the first GraphQL server answers every page slowly and never lists the genuine mirror
- **THEN** the second server's record of the genuine mirror is still found, within the per-server budget

#### Scenario: Original buried by newer spam
- **WHEN** more than 50 newer transactions tagged with the victim's locator precede the genuine mirror
- **THEN** the genuine mirror is still found within the budget

### Requirement: Event history lookup is bounded
History lookups SHALL share one deadline per run, with every request's timeout clamped to it. Each RPC's `latest` block SHALL be cross-checked against the median (plausibility only), and implausible heads refused. Each accepted RPC SHALL page to its own head, so a low head shortens only its own history, which then disagrees; it can never produce a shortened agreed history. The lookup SHALL fail at once when the range cannot fit the page budget.

#### Scenario: Hostile block number
- **WHEN** an RPC reports a head of 10^9 while the others report about 5×10^7
- **THEN** that RPC is refused for history with a warning, without paging `eth_getLogs`

#### Scenario: Low head cannot shorten the history
- **WHEN** two RPCs are configured, one serves the older blob and reports a head between the creation and the latest update
- **THEN** the older copy is never labelled current (the histories disagree, so the result is unverifiable or an explicit choice)

#### Scenario: Sole RPC with hostile head
- **WHEN** the only RPC reports a head of 10^9
- **THEN** the lookup fails immediately as unverifiable, without paging `eth_getLogs`

### Requirement: Timeout must be finite
`--timeout` SHALL be a finite number greater than 0 and at most 300 seconds; any other value SHALL be a usage error.

#### Scenario: Non-finite timeout
- **WHEN** the user passes `--timeout inf` or `--timeout nan`
- **THEN** the tool exits with a usage error before contacting any server
