# Tasks

## 1. vault-crypto (tests first)

- [x] 1.1 Unit tests: the create options carry credProtect level 3 with enforcement (and the get options don't); `credProtectLevel` / `assertCredProtectUvRequired` accept level 3 and refuse levels 1 and 2, a missing extension, a non-integer value, no AT, truncated or trailing data, and a look-alike outside the extension map.
- [x] 1.2 Implement `credprotect.ts` (a bounded CBOR reader), the `CRED_PROTECT_UNSUPPORTED` error and the option fragment.

## 2. Web app (tests first)

- [x] 2.1 Unit tests: the enrollment request carries the policy and enforcement; refusal for levels 1 and 2, for a missing level, and for an enforcing-browser failure (never enrolled); the plain message and title; the enrollment-cancel wording; a level-3 credential can't be asserted without UV; the user-operation `getFn` rejects a non-UV signature and always asks for UV.
- [x] 2.2 Implement the `enrollKey` check, `KeyError('CRED_PROTECT_UNSUPPORTED')`, the strings and the cancel mapping. Make the unit fake authenticator credProtect-aware.
- [x] 2.3 E2E: a fixture shim (D5) and `13-credprotect.spec.ts` (real refusal without the shim; every enrollment requests level 3 with enforcement). The existing suite stays green.

## 3. Docs and specs

- [x] 3.1 `docs/spec/vault-format-v1.md` §3.1a and the error table; `docs/system-design.md`; the web-app `hardware-key-auth` spec (updated in place in `add-web-app`). Record the residual risk: pre-change keys must be re-created (only the founder's test vault), and a contract-level UV/rpId/origin validator is planned before mainnet.
- [x] 3.2 Recovery tool: no change (CTAP2 `getAssertion` with UV works with credProtect 3). Noted in the design.

## 4. Review

- [x] 4.1 Security review of the change (the CBOR parser, the enrollment path, the error mapping, the E2E shim confined to tests); record it in `docs/reviews/enforce-credprotect-uv.md`.
