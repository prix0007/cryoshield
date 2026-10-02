# Proposal

## Why

The founder confirmed two launch decisions on 2026-10-02:
- **License:** "anything which is public and OSS". The repo had no LICENSE file, so it was not legally open source, even though contracts, `vault-crypto` and the recovery tool already declare MIT.
- **Mainnet:** mainnet will be OP Mainnet. There are no funds yet, so deployments stay on OP Sepolia only.

## What Changes

- Add an MIT `LICENSE` at the repo root, matching the existing SPDX headers (`contracts/src`) and package metadata (`@cryoshield/vault-crypto`, `cryoshield-recover`).
- Declare `"license": "MIT"` in `apps/web/package.json` and the root `package.json`.
- Record OP Mainnet as the decided mainnet chain in the PRD, the README and `openspec/config.yaml`.
- No mainnet deployment happens. The recovery tool's `DEFAULT_NETWORK` stays `op-sepolia` until an OP Mainnet deployment record exists.
- CI fix found on the first real GitHub run: the `web` job now builds `@cryoshield/vault-crypto` before typechecking. Its types resolve from the gitignored `dist/`.

**Out of scope:**
- Deploying to OP Mainnet.
- Removing Arbitrum presets (they stay as configured chains).
- Relicensing the vendored `forge-std`.

**Runtime dependencies:** none added. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- `project-licensing`: the open-source license of every published artifact, and how it stays consistent.

### Modified Capabilities
- None. The mainnet decision is project context, not a behaviour change; `deployment-targets` already defines the `op-mainnet` preset.

## Impact

- **New files:** `LICENSE`.
- **Metadata:** `package.json` files.
- **Docs:** README, PRD, `openspec/config.yaml`.
- **CI:** `.github/workflows/ci.yml` (`web` job).
