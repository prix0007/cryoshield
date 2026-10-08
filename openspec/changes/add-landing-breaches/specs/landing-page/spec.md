# Spec Delta

## MODIFIED Requirements

### Requirement: Story tiles
The landing page SHALL present, in order:
- a hero ("Seed phrase backups that outlive the drive.");
- a band of key numbers;
- the story scenes and tiles:
  - fragile media ("Drives fail. Paper fades.");
  - leaked copies ("Where backups leak."), a tile of cited incidents with a call to action;
  - the tap ("One tap. Sealed in your browser.");
  - storage ("Stored on-chain. Copied to Arweave.");
  - "Only you can read it." (a comparison with typical cloud storage);
  - "Lose a key, not your vault.";
  - "Survives us too.";
  - the permanence timeline ("Built for decades.");
- "Free to use.";
- a final call to action ("Back up your seed phrase once.");
- an FAQ ("Backup questions, answered.");
- a footer linking to the source code, the recovery tool documentation, and the license.

The hero, "Where backups leak.", "Free to use." and the final call to action SHALL each offer one or two pill calls
to action. A scene MAY offer at most two.

#### Scenario: Tile order and CTAs
- **WHEN** the landing page is rendered
- **THEN** the sections' level-2 headings appear in the order above, the hero, "Where backups leak.", "Free to use." and the final call to action each contain one or two pill links, and every pill leads to `/app/`, an in-page anchor, or the project's source code or documentation

#### Scenario: Footer links
- **WHEN** the footer is rendered
- **THEN** it links to the GitHub repository, the recovery tool documentation, and the MIT license

## ADDED Requirements

### Requirement: Breach stories with sources
The "Where backups leak." tile SHALL be a plain tile (not a pinned scene, no new JavaScript) that shows three
incident cards, each with:
- a short label naming where the copy was kept;
- the incident, stated no more strongly than its cited source;
- a visually distinct line saying how CryoShield helps, limited to what the shipped code does, with any icon
  decorative (`aria-hidden`);
- a link to its source whose accessible name says it is a source (e.g. "Source: Kaspersky").

The cards SHALL be: LastPass 2022 (source BleepingComputer), SparkCat 2025 (source Kaspersky) and Slope 2022 (source
The Block). Under the cards the tile SHALL state the honest limit that no backup can protect a phrase typed on a
device that is already infected. It SHALL end with a call to action: "Seal it with your security key" (`/app/`) and
"Read the code" (the GitHub repository).

Source links MUST NOT open a new window and SHALL carry `rel="noopener noreferrer"`. The tile's text MUST pass the
landing honesty denylist and MUST NOT claim that CryoShield prevents hacks in general. The cards SHALL stack in one
column at phone width without horizontal scrolling, and the tile SHALL pass axe (colour contrast included) in both the
light and dark themes.

#### Scenario: Cards and sources present
- **WHEN** the landing page HTML is checked
- **THEN** `#breaches` follows `#fragile` and precedes `#how`, has no `data-scene`, contains three cards with their labels, incidents, helps lines and source links to the three recorded URLs (each with `rel="noopener noreferrer"`, no `target`, and an accessible name starting "Source:"), the honest-limit sentence, and the two pills with their hrefs

#### Scenario: Honest copy
- **WHEN** the tile's text is checked against the landing denylist
- **THEN** nothing matches, and no sentence claims CryoShield stops hacking in general

#### Scenario: Themes and phone width
- **WHEN** the tile is audited with axe in forced Light and forced Dark at 1280 px and 390 px
- **THEN** there are no violations, the three cards share one column at 390 px, and the page has no horizontal scroll
