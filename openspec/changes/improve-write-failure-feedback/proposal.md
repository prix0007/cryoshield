# Proposal

## Why

Live testing found two problems with write failures:
- **Wrong message:** on a first vault create, a refused sponsorship says "Your existing vault is safe", but no vault
  exists yet.
- **No way to diagnose:** operators can't tell from the screen why a write failed unless they open devtools.

## What Changes

- A refused sponsorship during **create** says "Nothing was saved. Please try again later." Edits and add-key keep
  the existing "Saving is paused…" message.
- Every write failure shows a collapsed **Details** disclosure with a non-secret error reference:
  - our error code (e.g. `SPONSORSHIP_REFUSED`);
  - the JSON-RPC error code and message from the bundler/paymaster, when there is one.

  The reference is sanitized: no URLs (which could carry an API key), no hex longer than 8 characters (keys,
  signatures, PRF output, addresses, calldata), and at most 160 characters.

**Out of scope:** any change to the write path, the retry logic, the paymaster policy, or logging. Nothing is sent
anywhere: the reference is only displayed.

**Runtime dependencies:** none.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `app-visual-design`: adds the write-failure reference and create-specific sponsorship copy.

## Impact

- `apps/web/src/ui/{operations,strings,components,CreateFlow,VaultView,ceremony}.ts(x)`, with unit tests and an E2E
  for the create-time refusal.
