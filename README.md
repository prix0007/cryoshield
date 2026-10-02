# CryoShield

Permanent, non-custodial backup for the secrets you can't afford to lose (seed phrases, 2FA backup codes, recovery codes).

- Secrets are encrypted **in your browser**. CryoShield never sees them and runs no servers.
- Only your **FIDO2 hardware keys** (YubiKey 5, firmware ≥ 5.2) can unlock a vault. You enrol at least two, and any one of them opens it.
- The encrypted vault lives on an EVM rollup (testnet: **OP Sepolia**; mainnet chain to be decided between OP Mainnet and Arbitrum One), mirrored to **Arweave**. Gas is sponsored, so you never need a wallet or crypto.
- If CryoShield disappears, the open-source **desktop recovery tool** still unlocks your vault, straight from the public chain.

> Status: pre-MVP. Not audited. Not deployed to any public network yet. Testnet target: OP Sepolia (chain 11155420). Get test ETH from the [Superchain faucet](https://console.optimism.io/faucet).

## Repository layout

| Path | What | Spec |
|---|---|---|
| `packages/vault-crypto` | Vault format v1: PRF → HKDF-SHA256 → AES-256-GCM envelope encryption, vaultId-bound AAD, Shamir option, test vectors | `openspec/specs/vault-crypto` · `docs/spec/vault-format-v1.md` |
| `contracts` | `VaultRegistry` (Foundry): no admin, no upgrades, append-only locator index | `openspec/changes/add-vault-registry-contract` |
| `apps/web` | Static web app: WebAuthn PRF, ERC-4337 passkey smart account, sponsored gas, Arweave mirror | `openspec/changes/add-web-app` |
| `tools/recover` | `cryoshield-recover` Python CLI (CTAP2 hmac-secret), an independent second implementation of the format | `openspec/changes/add-desktop-recovery-tool` |
| `docs/reviews` | Security review records | |

The product requirements live in `.claude/PRPs/prds/cryoshield.prd.md`.

## How we work: OpenSpec is mandatory

Every feature, fix, and refactor starts as an OpenSpec change. No code is written without one.

```sh
openspec list              # active changes
openspec view              # dashboard
openspec validate --all --strict
```

Workflow: `/opsx:propose`, then implement with TDD via `/opsx:apply`, then a security review (required for any change touching crypto, contracts, the paymaster, or secret handling), then `/opsx:archive`. Project-wide constraints are in `openspec/config.yaml`.

## Development

Prerequisites: Node 22 and pnpm 9, Foundry 1.1.0, Python ≥ 3.10 with uv, and the openspec CLI 1.14.0.

```sh
pnpm install --frozen-lockfile

# crypto library
pnpm --filter @cryoshield/vault-crypto test

# contracts
cd contracts && forge test && forge snapshot --mc GasTest --check

# web app (unit, integration on local anvil, E2E with a virtual authenticator)
pnpm --filter @cryoshield/web test
pnpm --filter @cryoshield/web test:int
pnpm --filter @cryoshield/web test:e2e
pnpm --filter @cryoshield/web verify-build

# recovery tool
cd tools/recover && uv sync --locked && uv run pytest -q
```

Dependency install scripts are disabled (`pnpm.onlyBuiltDependencies: []`).

Real-hardware checklists:
- `apps/web/docs/hardware-test.md`
- `tools/recover/docs/manual-yubikey-test.md`

## Continuous integration

`.github/workflows/ci.yml` runs one job per area. Each job runs only when its paths change:
- `contracts`: build, tests, gas snapshot, Slither
- `vault-crypto`: Node and Chromium
- `recover`: Python 3.10 and 3.12
- `web`
- `openspec`: strict validation
- `workflow-lint`

A final **`ci-ok`** job aggregates the results. Skipped jobs count as passing; failed or cancelled jobs fail it.

How the workflow is hardened:
- every third-party action is pinned by commit SHA (Dependabot keeps them updated);
- `permissions: contents: read`;
- no secrets are exposed to pull requests;
- installs fail on lockfile drift.

**Manual step (repository admin):** in GitHub → Settings → Branches, add a branch-protection rule for `main` that requires the status check **`ci-ok`**, and require pull requests before merging.

## Security

There is no external audit for the MVP. Mitigations: an open specification, deterministic cross-implementation test vectors, symmetric-only cryptography, and an internal adversarial review of every security-relevant change (`docs/reviews/`, `apps/web/docs/security-review.md`). Please report vulnerabilities privately to the maintainers rather than in public issues.

## License

TBD. The project will be open source.
