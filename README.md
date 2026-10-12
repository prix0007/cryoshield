# CryoShield

Permanent, non-custodial backup for the secrets you can't afford to lose (seed phrases, 2FA backup codes, recovery codes).

- Secrets are encrypted **in your browser**. CryoShield never sees them and runs no servers.
- Only your **FIDO2 hardware keys** (YubiKey 5, firmware ≥ 5.2) can unlock a vault. You enrol at least two, and any one of them opens it.
- The encrypted vault lives on an EVM rollup (**OP Mainnet**; currently testnet-only on **OP Sepolia**), mirrored to **Arweave**. Gas is sponsored, so you never need a wallet or crypto.
- If CryoShield disappears, the open-source **desktop recovery tool** still unlocks your vault, straight from the public chain.

> Status: testnet only (OP Sepolia), at https://cryoshield-web-dev.fly.dev. Not audited.

## If you need your vault

- **Recover without the website:** [`tools/recover/README.md`](tools/recover/README.md) explains how to install or download `cryoshield-recover` and unlock a vault with one of your keys, using only public RPCs or Arweave.
- **Lost or compromised hardware key:** follow [`docs/lost-or-compromised-key.md`](docs/lost-or-compromised-key.md).
- **Which keys work:** [`docs/supported-devices.md`](docs/supported-devices.md).

## How it works

The architecture, key derivation and flows are in [`docs/system-design.md`](docs/system-design.md). The vault format is specified in [`docs/spec/vault-format-v1.md`](docs/spec/vault-format-v1.md), with deterministic test vectors in `packages/vault-crypto/test-vectors/`.

| Path | What |
|---|---|
| `packages/vault-crypto` | Vault format: PRF → HKDF-SHA256 → AES-256-GCM, Shamir option, test vectors |
| `contracts` | Vault registry and smart wallet (Foundry). No admin, no upgrades |
| `apps/web` | Static web app: WebAuthn PRF, ERC-4337 passkey account, sponsored gas, Arweave mirror |
| `tools/recover` | `cryoshield-recover`, the Python desktop recovery tool and a second implementation of the format |
| `tools/metrics` | Aggregate, identifier-free metrics from public chain and Arweave data |

## Development

Prerequisites: Node 22 and pnpm 9, Foundry 1.1.0, Python ≥ 3.10 with uv, and the openspec CLI 1.14.0.

```sh
pnpm install --frozen-lockfile

pnpm --filter @cryoshield/vault-crypto test                  # crypto library
(cd contracts && forge test && forge snapshot --mc GasTest --check)
pnpm --filter @cryoshield/web test                           # web: unit
pnpm --filter @cryoshield/web test:int                       # web: integration on local anvil
pnpm --filter @cryoshield/web test:e2e                       # web: E2E, virtual authenticator
pnpm --filter @cryoshield/web verify-build
(cd tools/recover && uv sync --locked && uv run pytest -q)   # recovery tool
pnpm --filter @cryoshield/metrics test                       # metrics
openspec validate --all --strict
```

Real-hardware checklists: `apps/web/docs/hardware-test.md` and `tools/recover/docs/manual-yubikey-test.md`.

## Contributing / PR workflow

- **OpenSpec first.** Every feature, fix and refactor starts as a change under `openspec/changes/<name>/`. A PR that touches code or CI without one fails the gate (unless labelled `no-spec` with a `No-spec justification:` line).
- **Branch** as `feat/`, `fix/`, `ci/`, `docs/` or `chore/`. The **PR title** is a Conventional Commit (`fix(recover): handle empty log page`); it becomes the squash commit on `main`.
- Fill in the PR template. CI and an automated review run on every PR; the owner approves the review and merges PRs from outside contributors.

The full flow is in [`CLAUDE.md`](CLAUDE.md) → "Change flow". CI, branch protection and deployment details are in [`docs/maintainers.md`](docs/maintainers.md) and [`docs/deploy.md`](docs/deploy.md).

## Support the project

CryoShield is free, open-source software. If it helps you, you can send a voluntary donation in **ETH on Ethereum mainnet** (chain ID 1) to:

```
0xfb4172e26AC8735C06656f1df14151cFe8441481
```

- **Check the address.** It is also shown on [cryoshield.app/support](https://cryoshield.app/support). Before you send, check that the address there matches this README character for character, so a tampered page can't redirect your donation.
- **Use the right network and asset.** Send only ETH on Ethereum mainnet. Tokens, or ETH on other networks, sent to this address may be lost.
- **What donations fund:** gas sponsorship and hosting.
- **Terms:** donations are non-refundable and come with no perks, goods or services. This is an open-source project with no company behind it, so there are no tax receipts.

## Security

There is no external audit. CryoShield relies on an open specification, cross-implementation test vectors, symmetric-only cryptography and an internal review of every security-relevant change ([`docs/reviews/`](docs/reviews/)).

Report vulnerabilities privately, never in a public issue: see [`SECURITY.md`](SECURITY.md) or use [GitHub private vulnerability reporting](https://github.com/prix0007/cryoshield/security/advisories/new). **Never post seed phrases, recovery codes, PINs or keys in an issue.**

## License

[MIT](LICENSE).
