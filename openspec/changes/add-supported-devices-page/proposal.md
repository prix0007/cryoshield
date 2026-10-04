# Proposal

## Why

The founder wants a supported-devices page that lives in the repo, is deployed on a path, and is linked from the web
footer.

Today the requirements for a key are scattered across the FAQ, the error messages and the specs. Since
`enforce-credprotect-uv`, keys must also support credProtect level 3, a rule users can't see anywhere. People need one
honest place that says:
- what a key and a browser must support;
- what we have actually tested;
- how to report what works.

## What Changes

- **Single source:** `docs/supported-devices.md`. GitHub renders it in the repo, and the build renders it into a
  static page at **`/devices`**.
  - It uses the existing legal-pages Markdown renderer (escaped, link-scheme allowlist).
  - It gets the app CSP and the same security headers, and has no script and no analytics.
  - It has a "Last reviewed" date.
- **Content, with three statuses** (Tested, Expected to work, Not supported):
  - the key requirements, each with a one-line reason;
  - why platform and synced passkeys are refused;
  - the keys and browsers tables;
  - the recovery tool's requirements;
  - how to check your key (quoting the app's real refusal messages);
  - how to report a device.

  The only "Tested" claim is the YubiKey 5 create flow on 2026-10-03, and the page says what is still pending.
- **Device report form:** a new GitHub issue form, `.github/ISSUE_TEMPLATE/device-report.yml`, asking for the model,
  firmware, OS, browser, connection and what worked. It opens with the standard warning never to post secrets, and
  requires a no-secrets confirmation.
- **Links:**
  - "Supported devices" in the footers of the landing page, `/app`, the legal pages, `/architecture` and `/devices`;
  - the landing FAQ "What do I need?";
  - the app's key and browser error states ("See supported devices").
- **Plumbing:** the Vite input, the Caddy clean URL and no-cache rule, the CSP equality check, verify-build's page and
  analytics-confinement lists, the deploy smoke test, and CI's `web` path filter (so edits to the Markdown run the web
  tests).

## Capabilities

### New Capabilities
- `supported-devices`: the supported-devices page, its source, its content rules and its links.

## Impact

- **New files:** `docs/supported-devices.md`, `apps/web/devices/index.html` and the issue form.
- **Changed:**
  - the renderer hook (`vite-plugins/legal*.ts`);
  - `vite.config.ts`, `deploy/gen-context.mjs` and `scripts/verify-build.mjs`;
  - the footers (`legal/partials/footer.html`, `index.html`, `src/ui/chrome.tsx`);
  - `src/ui/components.tsx` (the error link);
  - `.github/scripts/deploy/smoke.sh` and `.github/workflows/ci.yml` (path filter).
- **Tests:** unit and build, container, E2E and issue-form tests. Screenshots are added.
- **Nothing else:** no new dependency, no new origin, and no change to the CSP or the landing JS.
