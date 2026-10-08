# Proposal

## Why

Founder request, 2026-10-09: "Also give in landing page CTA on recent hacks and how backups via cryoshield can help
since it's hardware based OSS encrypted backup solution, make sure it sells."

The landing page explains that storage media fail ("Drives fail. Paper fades.") but says nothing about the other way
seed phrases are lost: copies leak from the places people keep them (a password manager's cloud, a screenshot, an
app's logs). Three well-reported incidents make that risk concrete, and each maps to something CryoShield actually
does (no master password, sealing in the browser with a tap on a physical key, encryption before storage, open
source). Pairing them with a call to action gives visitors a reason to act now.

## What Changes

- **New landing section `#breaches`** ("Where backups leak."), placed right after the `fragile` scene and before the
  `how` scene, so the story runs: media fail → copies leak → how CryoShield works.
- It is a **normal tile** (`tile tile-parchment`), not a pinned scene: no `data-scene`, no new JavaScript.
- **Three incident cards** in a responsive grid (three columns on wide screens, one on phones), each with a short
  label, the incident, a visually distinct "how CryoShield helps" line (a decorative inline-SVG check icon,
  `aria-hidden`), and a source link ("Source: BleepingComputer", "Source: Kaspersky", "Source: The Block"):
  - LastPass, 2022 (stolen encrypted vault backups, weak master passwords cracked offline);
  - SparkCat, 2025 (store apps scanning photo galleries for seed phrase screenshots);
  - Slope, 2022 (researchers reported a wallet app sending seed phrases, unencrypted, to its error-logging server).
- **One honest limit** under the cards: no backup can protect a phrase typed on an infected device.
- **A closing call to action**: "Take your seed phrase out of the cloud." with two pills, "Seal it with your security
  key" (`/app/`) and "Read the code" (the GitHub repository).
- External source links use `rel="noopener noreferrer"` and never open a new window. The landing content test's
  external-link allowlist gains exactly these three source URLs.
- Styles in `src/landing/landing.css` from existing tokens only, so the section works in the light and dark themes.

**Out of scope:**
- any change to the hero, the meta title or description, the FAQ (and so its JSON-LD), or `llms.txt`;
- any claim beyond the vetted copy, in particular any claim that CryoShield prevents hacks in general;
- motion or scroll-linked effects for the new section; new JavaScript;
- naming the incidents anywhere outside this section.

**Runtime dependencies:** none. No new package and no new network request at load: the source links are ordinary
links the visitor may follow. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- none.

### Modified Capabilities
- `landing-page`: "Story tiles" lists the new section in the order; a new requirement "Breach stories with sources"
  pins the cards, their sources, the honest limit and the call to action.

## Impact

- `apps/web/index.html` (new section), `apps/web/src/landing/landing.css` (cards grid).
- Tests: `apps/web/test/landing/content.test.ts`, `apps/web/e2e/specs/05-landing.spec.ts`,
  `apps/web/e2e/specs/19-theme.spec.ts`, `apps/web/e2e/specs/90-screenshots.spec.ts`.
- Docs: `apps/web/docs/screenshots/` (new section shots, README).
