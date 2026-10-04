# Design

## Context

See proposal.md and the audit's proof scripts, which are now regression tests in `tools/recover/tests/test_network_trust.py`. The current code's trust model is "union, then authenticate, then rank". AES-GCM stops forgeries and the vaultId binding stops clones. What it does not stop is **rollback to an older genuine version**: ranking leaned on values a single source controls, namely the RPC-reported version, the GraphQL-reported size, and the Arweave version tag.

## Goals / Non-Goals

**Goals:**
- A single hostile source (one RPC, one GraphQL server) can never make an older genuine copy look current, or hide the genuine copy.
- Every per-source loop is bounded in time and requests.

**Non-Goals:**
- Defeating a *majority* of colluding sources. That is the documented residual risk; use `--rpc` with a trusted node, and later the L1 anchor.

## Decisions

### D1. State quorum on `getVault`
- RPC URLs are normalised (lower-case scheme and host, no trailing slash) and deduplicated before anything is counted. `quorum = min(2, distinct configured RPCs)`.
- For each vaultId, the tool counts the distinct RPCs returning each distinct blob (its *support*).
- A copy is `current` only if its support is at least the quorum **and** no RPC returned a different blob for that vaultId.
- Otherwise every copy of that vaultId is reconciled against the agreed event history (the existing rule: identical answers from at least `min(2, configured)` RPCs). A match with the latest hash makes the copy `current`; a match with an older hash makes it `outdated`; no match makes it `unmatched`. If there is no agreed history, the copies are `unverifiable`.
- **Variant B (the liar is the sole answer):** support 1 < quorum 2, and the history needs 2 answers but only the liar answers, so the copy is `unverifiable` with a warning, never `current`.
- *Alternative rejected:* trusting the history majority instead of exact agreement. One liar can make the history unverifiable (a denial of service), but cannot make an old copy verified. The fallback below handles that case.

### D2a. One settle step for every selected copy
Any-of-N and threshold (Shamir) vaults go through the same `_settle` step: tie resolution, then the confirmation for a cut-short search, with the secret wiped on any abort (security review H1).

### D2. Ranking without self-reported versions
- `Candidate.rank = (freshness class, −support, −arweave height)`. The version (from `getVault` or the Arweave tag) is display-only.
- **Variant A:** the history disagrees (the liar truncates it), so both copies are `unverifiable`. The honest copy has support 2 against the liar's 1, so the majority copy wins, with a warning.
- **Tie:** if the chosen copy is not chain-verified and another *different* blob for the same vaultId also decrypts with **equal** rank, the tool asks the user to choose between them. It shows, for each copy: the sources, the support count, and the status. It never shows a plaintext before the choice, and never shows a claimed version: that is attacker-writable, and a "version 4294967295" label would nudge users toward the older copy (security review round 2, M2). A non-interactive run exits `AMBIGUOUS` (12).
- *Alternative rejected:* "highest version wins", which is exactly the REC-M1 exploit.

### D3. Arweave records per server
- `_query` returns one `ArweaveTx` per (GraphQL server, tx id). Nothing is merged, and the record carries its `server`.
- A download is per tx id (cached), from the gateways, and never depends on a GraphQL claim. The claimed size is informational, and the 1024-byte read cap stays.
- Each record becomes its own candidate, with the vaultId from *that server's* tag. A hostile relabel produces a separate candidate that fails authentication, so it cannot replace the honest one. Candidates are deduplicated by (vaultId, blob).
- **Paging:**
  - Servers are queried **in parallel**, each with its own `ARWEAVE_SERVER_DEADLINE` (30 s), and each request's timeout is clamped to that budget (ECC review, PR #22). A slow first server cannot starve the others.
  - Per server, the oldest page (`HEIGHT_ASC`) comes first, then up to `ARWEAVE_MAX_PAGES` newest-first pages following the cursors.
  - A warning is shown when the page budget ends with `hasNextPage` still true.
  - A locator becomes public only when the vault is registered, so spam always post-dates the original mirror, and the oldest page reaches it.
- **Downloads:**
  - At most `MAX_FETCHES` (40) distinct tx ids within `FETCH_DEADLINE` (60 s).
  - Ordered per server by alternating the oldest and newest records, then interleaved across servers. There is no global sort by claimed height. This way the budget always reaches the original mirror (which can't be pre-spammed) and the latest update (security review H2).
  - Records of tx ids already downloaded are always kept.
  - Each gateway's timeout is clamped to the time remaining, and a too-large or empty answer falls through to the next gateway.
  - If any page, time or download budget cut the search short and the selected copy is not chain-verified, the user must confirm explicitly. A non-interactive run exits 12.
- **Ranking:** a merged Arweave candidate's height is the **minimum** any supporting server claimed. Any unverified, decrypting Arweave rival of the same freshness forces an explicit choice, because support and height are server-controlled.

### D4. Bounded event history
- One deadline (`HISTORY_DEADLINE`, 60 s) applies across all of a history lookup's paging.
- `latest` is read once per run from every usable RPC. The median is only a plausibility filter: an RPC more than `HEAD_TOLERANCE` (5,000) blocks from it is refused ("implausible head").
- Each accepted RPC pages to **its own** head.
  - Paging every RPC to the median (the first version) let a low-head RPC shorten the *agreed* history (ECC review, PR #22).
  - Paging every RPC to the highest head fails in practice: op-geth and publicnode reject a `toBlock` beyond their own head (`-32602`, verified live 2026-10-04; security review M1).
  - With own-head paging, a low head shortens only its own history, which then disagrees, so the result is unverifiable.
  - "Beyond head" errors are not treated as range limits.
- `resolveLocator`/`getVault` reads share a separate per-run `STATE_DEADLINE`, with clamped timeouts (security review L3).
- One deadline covers the whole Registry run (heads, all vault ids, all pages), and each request's timeout is clamped to the time remaining.
- If the remaining blocks divided by the page size exceed the page budget, the lookup fails at once, before any `eth_getLogs`.
- Once an RPC has forced the page size down (a range-limit error), at most `MAX_ADAPTED_PAGES` (200) remaining pages are allowed. Live finding (2026-10-04): drpc's ~100-block limit meant more than 1,000 pages after two days of history, so every lookup hit the 60 s deadline. drpc now drops out in about 7 s, and the other two RPCs still provide the agreed history.

### D5. REC-L2: distinct key material
`createVault` (TypeScript, the Python generator, and the test writer) rejects any two credentials with equal PRF outputs, with `INVALID_ARGUMENT`. Equal PRF outputs imply equal locators, so equal locators are rejected too. The check runs after the PRF-length checks and before the secret and size checks, so error precedence is unchanged for every existing vector.

## Threat / Abuse Considerations

- **1 liar of N ≥ 3 RPCs:**
  - It can no longer make an old copy current (quorum and history agreement), and it can't win the ranking (support, not version).
  - It can still force `unverifiable` labels, which is a denial of service with a warning, never a silent rollback.
- **Liar as the sole responsive RPC:** the copy is shown as `unverifiable`, with a warning; it is never shown as current.
- **2 configured RPCs, 1 liar:** an equal-support tie, so the user must choose explicitly, with a warning.
- **Majority collusion:** remains a residual risk, documented.
- **Hostile GraphQL server:**
  - It cannot suppress another server's record (records are not merged) or stop a download (claimed sizes are ignored).
  - Burying is bounded by paging plus the oldest-first page.
  - A cost: a hostile server can add junk records, each costing at most one 1024-byte download per tx id and one AES-GCM attempt, within the page budget.
- **Hostile `eth_blockNumber`:** refused by the cross-check, or by fail-fast plus the deadline; at most one lookup's deadline is spent.
- **Equal PRF outputs:** a vault can't be created whose "two keys" are one key, so the "≥ 2 keys" guarantee is real.

## Risks / Trade-offs

- [More user interaction on ties] → Ties are rare with ≥ 3 healthy RPCs. The choice is explicit and labelled.
- [More GraphQL requests] → Bounded by the page and time budgets, and a hit stops further paging only when the chain path already succeeded.
- [The new vector changes `v1.json`] → It is additive only (a new create case), with no existing bytes changed. The recovery tool re-pins it.

## Migration Plan

Nothing is deployed in the tool's distribution channel yet; this ships with the next release. The vectors are additive.
