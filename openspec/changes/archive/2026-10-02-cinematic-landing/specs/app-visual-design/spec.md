# Spec Delta

## ADDED Requirements

### Requirement: Link decoration
These elements MUST NOT show a text underline in any state (rest, hover, focus, active):
- pills and buttons;
- the logo or wordmark;
- global-nav, sub-nav and footer navigation links.

Hover feedback on nav and logo links SHALL be a subtle opacity change. Inline links inside body copy SHALL be
underlined at rest, so they are identifiable without hover or colour alone. This applies to the landing page and the
app.

#### Scenario: Hover never underlines chrome
- **WHEN** the pointer hovers the logo, each global-nav link, each footer link and each pill on `/`, and the logo, nav links and buttons on `/app/`
- **THEN** each element's computed `text-decoration-line` is `none`

#### Scenario: Inline links stay identifiable
- **WHEN** an inline link appears inside body copy
- **THEN** its computed `text-decoration-line` is `underline` without hover
