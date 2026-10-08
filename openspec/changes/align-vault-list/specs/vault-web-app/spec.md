# Spec Delta

## MODIFIED Requirements

### Requirement: Vault view column alignment
On the open vault, the secret cards, the action bar, the Manage vault list, the All vaults button and the "Where your
vault is stored" card SHALL share the content column's left and right edges, at every viewport width. On the All
vaults screen, the vault cards and the action bar SHALL share the same edges. No block MUST stick out past the column
or stop short of it. The action bar SHALL keep its sticky tray and SHALL NOT extend past the column in any flow. The
app footer's divider SHALL span the content column only.

#### Scenario: Aligned at desktop and phone width
- **WHEN** an open vault is shown at 1024 px or 390 px wide
- **THEN** those blocks' left edges are equal and their right edges are equal, within 1 px

#### Scenario: All vaults screen aligned
- **WHEN** the All vaults screen is shown at 1024 px or 390 px wide
- **THEN** every vault card and the action bar have the content column's left and right edges, within 1 px

#### Scenario: Location card
- **WHEN** "Where your vault is stored" is shown, collapsed or expanded
- **THEN** it is one full-width card, and its expanded details sit inside it without a second border
