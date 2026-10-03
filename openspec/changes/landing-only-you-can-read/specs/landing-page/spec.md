# Spec Delta

## MODIFIED Requirements

### Requirement: Story tiles
The landing page SHALL present, in order:
- a hero ("Backups that outlive the drive.");
- a band of key numbers;
- the story scenes and tiles:
  - fragile media ("Drives fail. Paper fades.");
  - the tap ("One tap. Sealed in your browser.");
  - storage ("Stored on-chain. Copied to Arweave.");
  - "Only you can read it." (a comparison with typical cloud storage);
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

## ADDED Requirements

### Requirement: Honest comparison with cloud storage
The "Only you can read it." tile SHALL contain a `<table>` with a `<caption>`, column headers "Typical cloud storage"
and "CryoShield", and these rows:
- who can read your data;
- account and password to lose or have hacked;
- can be frozen, deleted or shut down;
- works if the company disappears.

Under the table it SHALL show the disclaimer that some password managers also encrypt end to end. The tile MUST NOT
say the data stays on the user's device, and MUST NOT name a competitor.

#### Scenario: Table and disclaimer present
- **WHEN** the landing page HTML is checked
- **THEN** the tile has the table, caption, headers and four rows, and the sentence beginning "Some password managers also encrypt end to end." directly follows the table

#### Scenario: No overclaim
- **WHEN** the tile's text is checked
- **THEN** it does not match "stays on your device", "never leaves your device" or a list of competitor names

### Requirement: Comparison reveal respects reduced motion
The table rows SHALL reveal one by one when the table scrolls into view, using transforms and opacity only. With
reduced motion or without JavaScript, every row SHALL be visible immediately and nothing SHALL animate.

#### Scenario: Reduced motion
- **WHEN** the page loads with `prefers-reduced-motion: reduce` and the table is scrolled into view
- **THEN** every row is visible with full opacity and no animation runs
