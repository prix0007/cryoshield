# Sponsorship policy (Pimlico)

CryoShield pays gas for every vault write. Nothing CryoShield operates sits between the app and the paymaster. The
controls are: (1) the client-side allowlist, (2) Pimlico's server-side policy and API-key restrictions, and (3) the
VaultRegistry's own caps.

## 1. Client-side allowlist (enforced in code: `src/account/policy.ts`)

Before the bundler or paymaster is contacted, every call in the user operation must satisfy all of:
- `value == 0`;
- a target of the **VaultRegistry** with selector `createVault(bytes32,bytes,bytes32[])`,
  `updateVault(bytes32,bytes)` or `addLocators(bytes32,bytes32[])`, **or** a target of **the account itself** with
  `addOwnerPublicKey(bytes32,bytes32)` (add-key flow only);
- the signed `callData` decodes as `execute` / `executeBatch` of such calls. This is checked again inside the paymaster
  hook on the exact operation being sponsored.

There is never an unsponsored fallback.

## 2. What Pimlico can enforce server-side

Verified from Pimlico's documentation (2026-10-02):
- **Sponsorship policies:** a global spend limit, a per-user (per sender) limit, and a per-user-operation limit; scoped
  per chain. The policy ID is passed as ERC-7677 paymaster context `{ sponsorshipPolicyId }`.
- **API-key restrictions:** allowed origins/domains, user agents, IPs, and a method allowlist (bundler / paymaster /
  account APIs).
- **Sponsorship webhooks:** can approve or deny each operation. They need a server we operate, so **rejected**.

**Not verified: target-contract or calldata restrictions.** Pimlico's docs mention allowlists but don't document a
policy rule that limits sponsored calls to one contract or selector. **Treat it as unavailable.** The global and
per-account caps are the real backstop. The client-side allowlist only constrains honest copies of our app: anyone can
call the public API key from a script, inside the caps.

## 3. Settings to apply (operations step, per chain)

| Setting | Value |
|---|---|
| Chain | OP Sepolia (`optimism-sepolia`) for the testnet; the same settings apply to any configured chain |
| EntryPoint | v0.6 (Coinbase Smart Wallet v1.1) |
| Per-sender limit | 10 operations and $0.50 lifetime |
| Per-operation limit | $0.20 |
| Global limit | $20 per day, alert at 80% |
| API key | origin = production RP ID host only; methods = bundler + paymaster only |
| Target restriction | VaultRegistry + self `addOwnerPublicKey`, **if** the dashboard offers it |

## Private bundler endpoint

`VITE_BUNDLER_URL` points at Pimlico's RPC endpoint. User operations go straight to Pimlico over HTTPS and are not
gossiped to the public ERC-4337 p2p mempool by the client. On OP Stack and Arbitrum chains, a centralized sequencer
orders transactions, with no public pending-transaction mempool. The design also tolerates front-running:
- locator registration is non-exclusive;
- a stolen `vaultId` leads to one retry with a fresh random id;
- a full locator (`LocatorFull`) leads to enrolling a fresh credential.

## Abuse bound

The worst case is an attacker scripting fresh accounts until the global daily cap is spent. That is a cost and
availability problem only: existing vaults stay readable and unlockable, and the app says "Saving is paused right now".

**Vault cloning is sponsorable, but neutralised.** Anyone can copy a victim's public blob and locators into a vault of their
own: it is an ordinary `createVault` call, within the allowlist and the caps. Since `bind-vault-id-to-ciphertext`, the
vaultId is in the wrap and payload AAD, and the app opens every candidate only under its own on-chain vaultId. A clone
under another vaultId never decrypts, so it is never offered and can never receive the victim's edits. This is proven by
`test-int/writes.int.test.ts` ("vault cloning is neutralised"). Clones only cost us sponsored gas, which the caps bound.
