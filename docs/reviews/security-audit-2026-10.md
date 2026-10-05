# Security audit: October 2026

**Date:** 2026-10-04
**Method:** four independent, read-only internal security reviews, run in parallel. Each finding is marked PROVED (reproduced with a throwaway test or proof-of-concept) or theoretical. Nothing was changed during the audit, no transactions were sent, and the live-site probing was limited to about 60 requests.

**Scope:**
- the vault-crypto library and the recovery tool;
- the contract, account abstraction and the paymaster;
- the web app and the live site;
- CI/CD and the supply chain.

This is not an external audit. CryoShield remains unaudited by any third party.

## Summary

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| CI/CD and supply chain | 1 | 2 | 4 | 3 |
| Contract, AA and paymaster | – | 1 | 3 | 1 |
| Web app and live site | – | – | 3 | 3 |
| Crypto library and recovery tool | – | – | 2 | 2 |

**Verified sound:**
- **Crypto core:** 20,000 mutated blobs gave zero disagreements between the TypeScript and Python implementations. Nonce handling, AAD binding including vaultId, HKDF domain separation, constant-time tags and the parser bounds all held.
- **Contract:** access control holds and there is no admin path. The live bytecode matches the source (Blockscout full match, Sourcify exact match).
- **Live site:** no open redirects, framing or injection sinks. The served bundle is byte-identical to a rebuild of the deployed commit.
- **CI:** all actions are SHA-pinned, no `${{ }}` injection, no caches, narrow allowlists, and no secrets in the git history.

## Findings and status

### Critical
| ID | Finding | Proof | Fix (planned) |
|---|---|---|---|
| CI-C1 | Any same-repo PR can reach production with no human in the loop. The gates are an LLM verdict the PR can steer and a `ci-ok` the PR produces; zero approvals are required, and continuous deploy follows. | PROVED (#17 and #19 were merged by the bot with only bot reviews) | A required reviewer on the `production` environment was added (`gate-production-deploys`), then **removed by founder decision on 2026-10-05** (`remove-production-approval-gate`). **Status: accepted risk for testnet; re-gate before mainnet.** |

### High
| ID | Finding | Proof | Fix (planned) |
|---|---|---|---|
| AA-H1 | One stolen key, **with no PIN**, can sign userOps. Coinbase Smart Wallet uses `requireUV: false` and ignores the rpId and origin. The attacker can add themselves as an owner and overwrite the vault. They cannot decrypt it. | PROVED (Foundry against the real CBSW v1.1 + EntryPoint v0.6 bytecode) | Enrol with credProtect `userVerificationRequired` (enforced) and reject keys without it. Before mainnet, a validator that checks the UV flag, rpIdHash and origin. |
| CI-H1 | Agents act with the sole admin's token, so rulesets don't bind them. | PROVED (token scopes) | Move agents to a separate write-only account or App |
| CI-H2 | The `ecc-review` check can likely be spoofed by a same-named job in a PR's `ci.yml`. | theoretical | Post the gate as a status from a dedicated App; auto-merge refuses PRs touching `.github/**` |

### Medium
| ID | Finding | Proof | Fix (planned) |
|---|---|---|---|
| AA-M1 | Locator stuffing (16 cap) is sponsorable by our own paymaster | PROVED | Registry v2: no per-locator cap, paginated `resolveLocator` (before mainnet) |
| AA-M2 | The preflight leaks the create call to the RPC before the signing tap, which enables vaultId squatting | theoretical | Registry v2: `vaultId = keccak256(msg.sender, salt)` |
| AA-M3 | Pimlico policy is client-selected; the public API key can probably be used without the policy and drain the balance | theoretical | Make the policy mandatory on the key if possible and keep the balance minimal; long term, an on-chain paymaster |
| WEB-M1 | The opener guard is bypassable from a script on `/`, which could read the app (dormant: no third-party script runs today) | PROVED (local) | Different COOP for `/` and `/app/`; reconsider any third-party script on the RP origin |
| WEB-M2 | Decrypted secrets have no idle lock on the "saved" screen and the vault chooser | code-evident | Idle lock in those states, plus a `pagehide` wipe |
| WEB-M3 | No published release manifest (`/release.json` 404; CD keeps the artifact for 7 days only) | PROVED | Publish a GitHub Release per deploy; fail the deploy if publishing fails |
| CI-M1 | A draft PR leaves a skipped, and therefore passing, `ecc-review` | theoretical | Run on drafts and fail the first step |
| CI-M2 | With strict mode off, two individually-benign PRs can combine into one payload | theoretical | Addressed by the human deploy gate (CI-C1) |
| CI-M3 | Scripts that run with the Fly token are not digest-pinned | code-evident | Pin `previous-image.sh` and `rollback.sh` |
| CI-M4 | The review-body credential filter is weak, the job summary is unfiltered, and there's a symlink risk on `.git/config` | theoretical | Remove symlinks before the agent runs; treat the filter as a backstop |
| REC-M1 | One lying RPC (of 3) can make recovery show an older vault version | PROVED | `getVault` quorum; never rank by a self-reported version |
| REC-M2 | One hostile Arweave GraphQL server can hide the genuine mirror; 50 newer items can bury it | PROVED (merge) | A separate candidate per server, ignore claimed sizes, cursor paging |

### Low
| ID | Finding | Fix (planned) |
|---|---|---|
| AA-L1 | RPC URLs (which may contain keys) are passed in argv in `deploy.sh` | Use the `foundry.toml` aliases |
| WEB-L1 | The clipboard is not cleared if the page is unfocused at 30 s | Retry on focus/visibility and on Lock |
| WEB-L2 | Phishing text from a bundler/paymaster error can reach the Details panel | Show allow-listed codes only |
| WEB-L3 | Mirror self-heal can be suppressed by locator-less copies | Require the locator tags to match |
| REC-L1 | A hostile `eth_blockNumber` can stall recovery for hours | An overall deadline, and cross-check `latest` |
| REC-L2 | `createVault` accepts identical PRF outputs (a fake backup key) | Reject equal PRFs/locators |
| CI-L1 | `allowed_actions: all`, SHA pinning not required server-side | Enable both settings |
| CI-L2 | The `uvx` tool installs and Foundry are not checksum-pinned | Hash or checksum pins |
| CI-L3 | The `dependabot.yml` comment is stale; Dependabot security updates are off | Update the comment; enable |

## Fix order

1. AA-H1: enforce credProtect UV at enrollment.
2. CI-C1 and CI-H1: the human deploy gate and the agent account (needs a founder decision).
3. REC-M1 and REC-M2, plus WEB-M1 and WEB-M2.
4. The remaining MEDIUM and LOW items, as tracked OpenSpec changes.
5. Before mainnet: registry v2 (AA-M1, AA-M2), the UV-checking validator (AA-H1, part 2), and an on-chain paymaster (AA-M3).
