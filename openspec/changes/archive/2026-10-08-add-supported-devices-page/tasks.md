# Tasks

## 1. Content and form (tests first)

- [x] 1.1 Content tests (`test/legal/devices.test.ts`):
  - a "Last reviewed" date that is valid and not in the future;
  - the required sections and requirements;
  - one allowed status per row, with "Tested" only with a date and the tested flow (YubiKey 5 create flow, pending items stated);
  - refusal messages quoted verbatim;
  - the issue form linked;
  - safe rendering.
- [x] 1.2 Write `docs/supported-devices.md`.
- [x] 1.3 Issue form `.github/ISSUE_TEMPLATE/device-report.yml`, validated in `.github/scripts/test/issue-templates.test.mjs`.

## 2. Page and links

- [x] 2.1 Build tests: `/devices` emitted with the h1 and title, the app CSP, no script, no third-party resource and no analytics; a footer link on every page; the FAQ link.
- [x] 2.2 Implement:
  - the `devices/index.html` shell and `renderRepoDoc`;
  - the Vite input and the clean-URL rewrite;
  - gen-context (Caddy route, no-cache, CSP pages);
  - verify-build page lists;
  - the smoke test;
  - the CI path filter.
- [x] 2.3 Footer links (landing, legal partial, app); the FAQ link; "See supported devices" on key and browser errors (unit tests in `test/ui/devices-link.test.tsx`).

## 3. Verification

- [x] 3.1 Container route test (`/devices` 200 with headers and no analytics; `/devices/` 200; `/devices/x` 404). Gen-context fixture updated.
- [x] 3.2 E2E `14-devices.spec.ts`: render and axe in light and dark, only same-origin requests, no CSP/Trusted Types errors, the footer link on every page, the FAQ link, and the app error link with axe.
- [x] 3.3 Screenshots in `apps/web/docs/screenshots/`.

## 4. Accessibility note

- [x] 4.1 A11y note recorded in `apps/web/docs/a11y-review-supported-devices.md`.
