# CryoShield web app: integration and E2E tests

```sh
pnpm --filter @cryoshield/web test          # unit (Vitest + Testing Library, jsdom)
pnpm --filter @cryoshield/web test:int      # integration: real EntryPoint v0.6 + Coinbase Smart Wallet + VaultRegistry on anvil
pnpm --filter @cryoshield/web test:e2e      # Playwright (Chromium) with CDP virtual authenticators
pnpm --filter @cryoshield/web verify-build  # reproducible build + bundle/CSP checks
pnpm --filter @cryoshield/web stack         # keep the local chain stack running for `pnpm dev`
```

Prerequisites: Foundry (`anvil`, `forge`) on PATH, `contracts/` built (`forge build`, plus `FOUNDRY_PROFILE=v1 forge build` for VaultRegistry v1 in `contracts/out-v1`), Playwright Chromium
(`pnpm exec playwright install chromium`). Everything runs offline.

## Projects (`playwright.config.ts`)

| Project | Device | Specs |
| --- | --- | --- |
| `chromium` | Desktop Chrome | all except `09-analytics` and `21-mobile` |
| `analytics` | Desktop Chrome, a build with the beacon on :4174 | `09-analytics` |
| `mobile` | Pixel 7 on Chromium (412 px, touch, coarse pointer) | the phone-relevant feature specs and `21-mobile` |
| `mobile-small` | Pixel 7 at 360 px | `21-mobile` |

The phone projects are Chromium only: the PRF virtual authenticator is CDP-only, so WebKit iPhone presets cannot run
the vault flows. `21-mobile` walks every page and vault screen by tap and checks no sideways page scroll, tappable
uncovered controls, targets of at least 24×24 px (under 44 px is reported as an advisory annotation), no clipped text,
and keyboard-reachable scroll containers. Which specs run on `mobile`, and why the others don't, is in
`openspec/changes/add-mobile-e2e/design.md` (D2). Run one project with `--project=mobile`.

CI runs two shards in parallel (OpenSpec change `parallel-e2e-shards`): `web-e2e (desktop)` runs
`--project=chromium --project=analytics`, and `web-e2e (mobile)` runs `--project=mobile --project=mobile-small`.
The analytics preview server (port 4174) starts only when the `analytics` project is selected, or when no
`--project` is given.

## Local chain stack (`e2e/stack/stack.ts`)

- **anvil** (chain 31337) on :8545.
- **Canonical contract code** placed with `anvil_setCode`, from `e2e/fixtures/chain-fixtures.json`: EntryPoint v0.6, its
  SenderCreator, and Coinbase Smart Wallet v1.1 (factory + implementation). The fixture was read from **OP Sepolia** (the
  testnet) by `pnpm fixtures:e2e` and pins each code hash. `chain-fixtures.arbitrum-sepolia.json` keeps the previous
  Arbitrum Sepolia copy; `test/build/fixture-parity.test.ts` requires the two to be byte-identical. Any difference
  blocks the change.
- **VaultRegistry** deployed exactly like `contracts/script/deploy.sh` (CREATE2, same salt), so the address equals
  `contracts/deployments/31337.json`. The stack fails loudly if not.
- **E2EPaymaster** (`e2e/contracts`), an accept-all v0.6 paymaster deposited in the EntryPoint.
- **Dev bundler** on :4337: `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`,
  `eth_supportedEntryPoints`, `pimlico_getUserOperationGasPrice`, and ERC-7677 `pm_getPaymasterStubData` /
  `pm_getPaymasterData`. Each user operation is submitted with `EntryPoint.handleOps`, so signatures (on-chain WebAuthn
  P-256 verification via the FreshCryptoLib fallback; anvil has no RIP-7212 precompile), account deployment, and registry
  calls all run for real. The pm_* methods emulate the sponsorship policy (policy ID, target/selector/value allowlist,
  per-sender and global refusal), the way Pimlico enforces it off-chain. Test-only controls: `cryoshield_setPolicy`,
  `cryoshield_stats`.

**Why not Alto + mock-paymaster?** Both need Docker or extra services, and neither ships Coinbase Smart Wallet. This
stack is a few hundred lines, deterministic, and offline. What it doesn't cover: ERC-7562 simulation and the real bundler's
gas estimation. Those are covered by Pimlico itself on Arbitrum Sepolia (`docs/hardware-test.md`).

## Virtual authenticators (task 2.4 result)

Chromium's CDP virtual authenticator supports `hasPrf: true`. It returns stable PRF results with UV, including at
`create()` (`e2e/specs/00-smoke.spec.ts`). **The PRF shim fallback is not needed and was not built.** Each "key" is a separate
authenticator, and `VirtualKeys.use(i)` enables user presence on that key only. Firefox and WebKit have no CDP virtual
authenticator; they are covered by the manual hardware checklist.

## Arweave / Turbo

`e2e/fixtures/arweave.ts` intercepts `https://upload.ardrive.io/**` and `https://arweave.net/**` with an in-memory store.
It parses the uploaded ANS-104 items, indexes their tags, and answers GraphQL tag queries.
