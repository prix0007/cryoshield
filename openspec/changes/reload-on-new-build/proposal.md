# Proposal: refuse writes from an outdated app build and offer a reload

## Why

A browser tab keeps running the code it loaded until it is reloaded. On 2026-10-10 that mattered:

- PR #85 (pad every payload to the maximum) reached dev at about 02:04 UTC. A save at 02:16 from a fresh tab wrote a
  1018-byte, maximum-padded blob, as designed.
- At 14:03 UTC an add-key from a tab opened **before** that deploy wrote vault version 10 with the old 64-byte-step
  padding: 615 bytes instead of 999 (tx `0x6180e582…d492`, vault `0x94a68b0b…5e87`, OP Sepolia). The blob was valid
  and the next save from a current tab re-padded it (version 11, 999 bytes), but for a while the public record carried
  exactly the length signal #85 removed.
- In the same stale tab, opening "Where your vault is stored" failed with "Couldn't load this section": its lazily
  loaded chunk no longer existed on the server.

Today the only defence is that the hashed chunks of an old build 404 after a deploy. That defence fails whenever the
old tab already loaded the write code (as here). After a future security fix, a stale tab would keep writing the old,
weaker behaviour to a permanent public record. A static site cannot push an update to an open tab, so the tab must
check before it writes.

## What Changes

- **Build check before every on-chain write.** Create, edit, rename, archive, "Archive and clear" and add-key first
  fetch the app's own page (same origin, `cache: 'no-store'`) and compare its module entry script with the one this
  tab is running. Vite's content hashes cascade through the import graph, so the entry name changes whenever any
  JavaScript the app can load changes (measured: a change confined to the lazy `VaultLocation` chunk changes the
  entry name; an unchanged tree rebuilds to the same name).
- **Outdated → nothing is written.** The flow stops before any key tap with a new `WriteError('OUTDATED')`, shown as
  "CryoShield was updated" with a **Reload page** button. The draft stays on screen until the user chooses to reload;
  it is never stored anywhere (the reload discards it, and the message says so).
- **Unknown → the write goes ahead (fail open).** A failed, slow (over 4 s), non-HTML or unparseable check never
  blocks saving (design D3).
- **Passive notice.** When the tab becomes visible again (throttled), the same check runs and, if the app has been
  updated, an info notice with **Reload page** appears in the app shell, so the user reloads before enrolling keys or
  typing secrets.
- **Reload button where code failed to load.** The "Couldn't load this section" fallback, the app's chunk-failure
  notice and the existing "part of the app didn't load" save error gain the same **Reload page** button.

No backend, no new origin (the check is a same-origin GET already allowed by `connect-src 'self'`), no storage, and
nothing secret is sent or read. The build and its reproducibility are unchanged: no build-time identifier is added.

## Capabilities

### Modified Capabilities
- `vault-web-app`: new requirements "Writes refuse an outdated app build" and "Reload offer for an outdated or
  missing app build".

## Impact

- `apps/web/src/lib/build-check.ts` (new), `src/ui/services.tsx` (`buildCheck`), `src/ui/operations.ts` (the check in
  `saveNewVault`, `rewrite` and `saveAddKey`; message), `src/account/errors.ts` (`OUTDATED`), `src/ui/components.tsx`
  (`ReloadButton`, Notice action, ChunkBoundary fallback), `src/ui/App.tsx` (passive notice), `src/ui/VaultView.tsx`
  (location fallback), `src/ui/strings.ts`, `src/ui/ceremony.ts`.
- Tests: `test/lib/build-check.test.ts`, `test/ui/build-check-flows.test.tsx`, `e2e/specs/41-outdated-build.spec.ts`
  (desktop and phone projects).
- Security review: required (touches the write path); recorded in design.md.
