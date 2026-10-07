# Tasks

## 1. Tests first

- [x] 1.1 Build test `test/build/architecture.test.ts`:
  - the page exists;
  - the heading, three `svg[role=img]` with aria-labels inside figures with figcaptions;
  - unique marker ids;
  - no `style=`, `<style`, `<script`, `="var(`;
  - the app CSP;
  - the live values equal the deployment file and the config (freshness guard);
  - the landing page, the legal pages and the app shell link to `/architecture`.

  Verify that it fails first.
- [x] 1.2 E2E `e2e/specs/11-architecture.spec.ts`: render, axe in light and dark, 390 px with no document overflow, and the figure scroll containers focusable. Container tests: `/architecture` 200 + no-cache + app CSP + headers, `/architecture/` 200, `/architecture/x` 404.

## 2. Build

- [x] 2.1 Port the artifact into `architecture/index.html` and `src/architecture/architecture.css` (D2/D4/D5). Add the value tokens and their replacement (D3), the partial name, the Vite input, the Caddy and preview routes, and the `gen-context`/verify-build lists. Add the links. Verify that 1.1/1.2 pass and `pnpm verify-build` is green.
- [x] 2.2 Screenshots: the page in light and dark (desktop), and on a phone.

## 3. Reviews

- [x] 3.1 Security note: no script, no third-party resource, the app CSP, no analytics, values from committed files only. Accessibility note: figure semantics, focusable scroll regions, contrast in both schemes, reflow. Record both in `apps/web/docs/review-architecture-page.md`.
