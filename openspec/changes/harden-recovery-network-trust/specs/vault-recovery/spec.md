# Spec Delta

## ADDED Requirements

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
When the selected copy is not chain-verified and a different blob for the same vault ID also decrypts with equal rank, the tool SHALL warn and ask the user to choose explicitly. Before the choice it SHALL show only public metadata (sources, support count, and the claimed version marked unverified), never plaintext. A non-interactive run SHALL exit with code 12 (`AMBIGUOUS`) and show no plaintext.

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
The tool SHALL follow GraphQL cursors newest-first, up to a page and time budget per server, and SHALL also fetch the oldest page, so the original mirror cannot be buried by newer transactions.

#### Scenario: Original buried by newer spam
- **WHEN** more than 50 newer transactions tagged with the victim's locator precede the genuine mirror
- **THEN** the genuine mirror is still found within the budget

### Requirement: Event history lookup is bounded
A history lookup SHALL have an overall deadline, and SHALL cross-check each RPC's `latest` block against the median of the usable RPCs. It SHALL refuse an RPC whose head is implausibly far ahead, and SHALL fail at once when the remaining range cannot fit the page budget.

#### Scenario: Hostile block number
- **WHEN** an RPC reports a head of 10^9 while the others report about 5×10^7
- **THEN** that RPC is refused for history with a warning, without paging `eth_getLogs`

#### Scenario: Sole RPC with hostile head
- **WHEN** the only RPC reports a head of 10^9
- **THEN** the lookup fails immediately as unverifiable, without paging `eth_getLogs`

### Requirement: Timeout must be finite
`--timeout` SHALL be a finite number greater than 0 and at most 300 seconds; any other value SHALL be a usage error.

#### Scenario: Non-finite timeout
- **WHEN** the user passes `--timeout inf` or `--timeout nan`
- **THEN** the tool exits with a usage error before contacting any server
