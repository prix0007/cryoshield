# Spec Delta

## MODIFIED Requirements

### Requirement: Story tiles
The landing page SHALL present, in order:
- a hero ("Backups that outlive the drive.");
- a band of key numbers;
- six story scenes:
  - fragile media ("Drives fail. Paper fades.");
  - the tap ("One tap. Sealed in your browser.");
  - storage ("Stored on-chain. Copied to Arweave.");
  - "Lose a key, not your vault.";
  - "Survives us too.";
  - the permanence timeline ("Built for decades.");
- "Free to use.";
- a final call to action;
- an FAQ;
- a footer linking to the source code, the recovery tool documentation, and the license.

The hero, "Free to use." and the final call to action SHALL each offer one or two pill calls to action. A scene MAY
offer at most two.

#### Scenario: Tile order and CTAs
- **WHEN** the landing page is rendered
- **THEN** the sections' level-2 headings appear in the order above, the hero, "Free to use." and the final call to action each contain one or two pill links, and every pill leads to `/app/`, an in-page anchor, or the project's documentation

#### Scenario: Footer links
- **WHEN** the footer is rendered
- **THEN** it links to the GitHub repository, the recovery tool documentation, and the MIT license

### Requirement: Motion respects reduced motion
Animated graphics and scenes SHALL convey nothing that is not also stated in text. When the user prefers reduced motion:
- the page MUST NOT load any motion or scene code;
- scenes MUST NOT pin;
- every scene MUST show a static, informative key frame.

Motion MUST NOT move or hide text the user is reading, and no animation MUST flash more than three times per second.

#### Scenario: Reduced motion
- **WHEN** the page loads with `prefers-reduced-motion: reduce`
- **THEN** no motion or scene chunk is requested, no scene stage is sticky, every scene graphic shows its key frame, and all scene text is visible

#### Scenario: Motion lazy-loaded
- **WHEN** the page loads with motion allowed and only the hero is in view
- **THEN** no scene chunk is requested until a scene approaches the viewport, and each scene's code is requested only for that scene

### Requirement: Landing performance budget
The build verification MUST fail if:
- the landing page's initial JavaScript exceeds 15 KB gzip;
- any lazily loaded landing chunk exceeds 40 KB gzip;
- the landing page's whole JavaScript graph exceeds 120 KB gzip.

The hero headline SHALL be in the HTML, so first contentful and largest contentful paint never wait for JavaScript.
Cumulative layout shift SHALL be 0. LCP SHALL be under 2.5 s on throttled mobile (Fast 3G-class).

#### Scenario: Budget enforced
- **WHEN** `verify-build` runs on a production build
- **THEN** it prints the measured gzip sizes and fails if any budget is exceeded, or if the landing graph includes React, viem or vault code

#### Scenario: LCP without JS
- **WHEN** the landing HTML is fetched without executing scripts
- **THEN** it contains the hero headline and every section's text

#### Scenario: Lab metrics
- **WHEN** Lighthouse (mobile, simulated Fast 3G-class throttling) runs against the production build
- **THEN** CLS is 0 and LCP is under 2.5 s, and the numbers are recorded in the repository

## ADDED Requirements

### Requirement: Pinned scroll scenes
Each story scene SHALL be a stage that stays in view (sticky) while its scroll track passes. The stage's visuals SHALL
be driven by scroll progress, from 0 to 1, using transforms and opacity only. Scenes SHALL use native scrolling:
nothing may intercept wheel, touch or keyboard scrolling. On narrow screens, scenes SHALL use shorter tracks and
simplified visuals.

#### Scenario: Scrubbed by scroll
- **WHEN** the user scrolls to 10% and to 90% of a scene's track
- **THEN** the scene's progress value reflects the position (low, then high) and its visual state differs accordingly, while the scene heading stays visible

#### Scenario: No scroll trap
- **WHEN** the user scrolls through the whole page with the keyboard (Page Down/Space) on desktop and with touch on a phone viewport
- **THEN** the page reaches the footer without any scene blocking or redirecting the scroll

### Requirement: Honest drama
Scene copy SHALL describe only what CryoShield does. Permanence claims MUST name what they depend on: the vault
remains readable while the chain or the Arweave copy exists, and while at least one key works. Copy MUST NOT state or
imply guaranteed, forever, or unbreakable storage.

#### Scenario: Permanence caveat
- **WHEN** the timeline scene is rendered
- **THEN** its visible text names the chain and Arweave dependency and the need for a working key, and the copy contains none of "guaranteed", "forever", "unbreakable", "never lose"
