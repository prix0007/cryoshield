# Security review: enforce-credprotect-uv (audit AA-H1)

The CryoShield security reviewer looked at branch `fix/enforce-credprotect-uv`.

**Verdict: APPROVE WITH NITS.** Every nit is addressed in this PR.

## What was confirmed

- **Enrollment:** it requests credProtect level 3 (`userVerificationRequired`) with enforcement, and confirms it from the
  registration `authenticatorData` before any PRF output or key is used.
  - Every enrollment path goes through `enrollKey`, including the second PRF tap and add-key. On failure it wipes the
    PRF copy.
  - A key that can't confirm level 3 is never enrolled, so no vault is saved on it.
- **Parser:** the bounded CBOR parser fails closed on every malformed input tried (15 adversarial inputs: big
  integers, floats, indefinite lengths, tags, duplicate keys, 20-level nesting, invalid UTF-8, trailing bytes, ED
  clear). None of them returned level 3.
- **Signing:** assertions are rejected without the UV flag before they reach the wallet (`prfCapturingGetFn`). Tests
  were added.
- **Error mapping:** nothing leaks.
- **E2E shim:** it lives only under `apps/web/e2e/`. Nothing test-only is in `src/`.
- **Recovery tool:** it already requires UV, and CTAP2 `getAssertion` with UV works for credProtect-3 credentials.
- **Tests:** vault-crypto 136/136, web unit 409/409, E2E 52 passed (7 skipped screenshot specs), int 12/12.

## Findings and resolutions

- **MEDIUM: U2F/CTAP1 residual.** The wallet ignores `rpIdHash` and UV, so a U2F signature with an attacker-chosen
  challenge parameter has the shape of a valid assertion. A key that accepts a CTAP2 credential ID over U2F could sign
  without its PIN.
  - **Resolution:** this is now documented in `docs/spec/vault-format-v1.md` §3.1a, `docs/system-design.md` and the
    change design.
  - The UV/rpId-checking contract validator, which closes it because U2F never sets UV, is recorded as a **hard
    mainnet gate**.
- **LOW: the parser accepted non-minimal integers.** **Resolution:** it now rejects them (canonical CBOR only), with a
  test.
- **LOW: a plain cancel showed the title "Key not supported".** **Resolution:** the enrollment-cancel message now uses
  the neutral title "Request cancelled". Its text still covers both causes.

## Residual risk (accepted until the validator ships)

- With `attestation: "none"`, the authenticator data is unsigned, so this check is a policy check and not proof
  against a malicious key.
- Keys enrolled before this change must be re-created. The only such vault is the founder's test vault.
