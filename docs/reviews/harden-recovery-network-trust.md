# Security review: `harden-recovery-network-trust` (PR #22)

- **Reviewer:** `security-reviewer` (read-only), two rounds, 2026-10-04
- **Scope:** the full diff `origin/main...fix/harden-recovery-network-trust`. That is `tools/recover` (`chain`, `arweave`, `recover`, `candidates`, `cli`, `ui`, `errors`, `rpc`), `packages/vault-crypto` (`createVault`, `gen-vectors.py`, `v1.json`) and `docs/spec/vault-format-v1.md`, checked against the change's proposal, design and spec deltas.
- **Inputs:**
  - the internal audit `docs/reviews/security-audit-2026-10.md` (REC-M1, REC-M2, REC-L1, REC-L2, INFO);
  - the ECC review of PR #22 (2 HIGH, 10 advisory).

## Verdict: APPROVE (round 2)

**Round 1 (CHANGES REQUESTED):** two more HIGH findings, both reproduced against the code.

| # | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| H1 | HIGH | Shamir (mode 0x02) vaults skipped tie resolution: on an equal-rank tie, the order the RPCs were listed in silently picked the older copy | `Recovery._settle` (ties, incomplete-search confirmation, wipe on abort) now runs for both the any-of-N and the threshold paths | Resolved, re-verified |
| H2 | HIGH | The download budget (newest-first) buried the genuine mirror again: genuine + 45 spam failed; plus a replayed old blob, the old secret was shown | Per server, records alternate oldest and newest, with no global sort by claimed height. `Arweave.truncated` is set when any budget cuts a search short, and an unverified copy then needs explicit confirmation (exit 12 when non-interactive) | Resolved, re-verified |
| M1 | MEDIUM | Paging every RPC to the highest head breaks providers that reject `toBlock` beyond their own head | **Verified live:** `sepolia.optimism.io` and publicnode return `-32602 "block range extends beyond current head block"`. Each RPC now pages to its own head; the median is only a plausibility filter, and "beyond head" errors are not range limits. A low head shortens only its own history, so the result is disagreement, i.e. unverifiable. Live history is agreed by 2 RPCs in about 8 s | Resolved |
| L1 | LOW | The download timeout was not re-clamped for each gateway | `fetch(deadline=)` clamps it for each gateway | Resolved |
| L2 | LOW | Hitting the budget also dropped cached records, which undercounted support | `continue`; cached records are kept | Resolved |
| L3 | LOW | State reads had no run deadline | `STATE_DEADLINE`, with clamped timeouts in `_eth_call` | Resolved |
| I1 | INFO | The forced choice or confirmation when the chain is down was undocumented | Added to the README | Resolved |

**Round 2 (APPROVE):** every round-1 item was re-verified with the reviewer's repro scripts. In none of the scenarios can a single source (one RPC, one GraphQL server, one gateway, or a third-party spammer) get an older genuine copy shown without an explicit prompt. Two non-blocking findings came up, and both were fixed in the same PR, test first:

| # | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| M2 | MEDIUM | The tie prompt showed the attacker-writable "claims version N" (for example 2^32−1), which nudges users toward the older copy | Labels now show only sources, support and status; the spec is amended | Fixed (`test_tie_labels_do_not_show_attacker_writable_versions`) |
| L4 | LOW | A tx whose download fails on every gateway didn't set `truncated` | It now sets it | Fixed (`test_download_failing_on_every_gateway_marks_search_incomplete`) |
| I2 | INFO | An HTTP 400 is treated as a range error before the "beyond head" text is checked | Bounded: the RPC drops out after a few halvings | Accepted |

## Checked
- **Quorum and support:** both key on `normalize_url`, and duplicate URLs count once.
- **No self-reported version** is used for ranking. An Arweave height is the minimum any server claimed.
- **Prompts:** no plaintext is shown before a choice or confirmation, and the secret is wiped on cancel, exit 12, or a failed re-open.
- **Bounds:** history (one run deadline, clamped timeouts, fail-fast, adapted-page cap), state reads, GraphQL (parallel servers, a budget per server, oldest page first) and downloads (count, deadline, timeout per gateway) are all bounded.
- **REC-L2:**
  - the byte-wise `assertDistinctPrfs` compares in constant time per pair and makes no copies of the PRF outputs;
  - the error order is unchanged;
  - `v1.json` is additive only, and `gen-vectors.py --check` reports it byte-identical;
  - the pin is `67c790c9…`.
- **`--timeout`:** must be finite and in (0, 300].
- **Suites:**
  - `tools/recover`: 380 passed, 5 opt-in skipped;
  - `packages/vault-crypto`: 134 passed, typecheck clean;
  - live read-only OP Sepolia smoke test: passed.

## Residual risks (accepted)
- **Colluding majority:** a majority of colluding RPCs or GraphQL servers can still serve an older genuine vault. The mitigation is `--rpc` with a trusted node, and later the L1 anchor.
- **URLs, not operators:** the quorum counts distinct URLs, not distinct operators.
- **Forced prompts:** a single source can still force "unverifiable" labels, a choice, or a confirmation (exit 12 when non-interactive). That is a denial of service with a warning, never a silent rollback.
- **Chain down:** with the chain unavailable and the current mirror buried in the middle of the history, getting it back may need a retry or the chain. The tool asks for confirmation and never picks silently.
