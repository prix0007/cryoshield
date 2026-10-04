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
When the selected copy is not chain-verified and a different blob for the same vault ID also decrypts with equal rank, or with the same freshness when either copy comes from Arweave (where support and height are server-controlled), the tool SHALL warn and ask the user to choose explicitly. Before the choice it SHALL show only public metadata (sources, support count, and the claimed version marked unverified), never plaintext. A non-interactive run SHALL exit with code 12 (`AMBIGUOUS`) and show no plaintext.

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
The tool SHALL query GraphQL servers in parallel, each within its own time budget, with every request's timeout clamped to that budget. Per server it SHALL fetch the oldest page first, then follow cursors newest-first within a page budget, and warn when that budget ends with results still pending. Downloads SHALL be bounded by a count and time budget, interleaved across servers.

#### Scenario: Slow first server
- **WHEN** the first GraphQL server answers every page slowly and never lists the genuine mirror
- **THEN** the second server's record of the genuine mirror is still found, within the per-server budget

#### Scenario: Original buried by newer spam
- **WHEN** more than 50 newer transactions tagged with the victim's locator precede the genuine mirror
- **THEN** the genuine mirror is still found within the budget

### Requirement: Event history lookup is bounded
History lookups SHALL share one deadline per run, with every request's timeout clamped to it. Each RPC's `latest` block SHALL be cross-checked against the median (plausibility only), and implausible heads refused. Every accepted RPC SHALL page to the HIGHEST accepted head, so a low head yields disagreement, never a shortened agreed history. The lookup SHALL fail at once when the range cannot fit the page budget.

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
