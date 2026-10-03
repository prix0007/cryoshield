# Security review: improve-write-failure-feedback

- **Date:** 2026-10-03
- **Reviewer:** frontend-engineer (self-review)

**Verdict: APPROVED.**

- **Display only.** `errorReference` is rendered in a collapsed `<details>` and is never sent anywhere or logged.
  Console calls are lint-banned and stripped from the build.
- **What can't leak:**
  - **URLs:** viem error messages include the bundler URL, which holds the Pimlico API key. Any `scheme://…` is
    replaced with `[url]`, and `apikey=`/`key=`/`token=` and `pim_…` are redacted.
  - **Hex:** values longer than 8 hex characters (signatures, calldata, PRF output, addresses, hashes) become `0x…`.
    Bare hex runs of 20+ characters become `…`.
  - **Size:** the output is capped at 160 characters for the message (200 overall).
  - **Source:** only `details`/`shortMessage` of the first JSON-RPC error in the cause chain is used, never `data`.
- **Unit tests** feed a URL with an API key, a 65-byte signature and an oversize message, and assert none survives.
  E2E checks that the reference on a real refusal holds `SPONSORSHIP_REFUSED` and no `http`.
- **Copy:** a create-time refusal no longer claims an existing vault is safe.
