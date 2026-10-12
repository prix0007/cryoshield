## MODIFIED Requirements

### Requirement: Open-source operator identity
The privacy policy and the terms SHALL name the operator as "CryoShield, an open-source project maintained by its
contributors (github.com/prix0007/cryoshield)". The privacy policy SHALL state that CryoShield holds no personal data
and that messages sent through GitHub are stored by GitHub. It MUST NOT describe the maintainers as a data controller
or Data Fiduciary. Neither page MAY name a company or a registered address.

#### Scenario: Operator stated
- **WHEN** the built `/privacy` and `/terms` pages are checked
- **THEN** each contains the operator sentence and a link to the repository, and neither contains "registered address" or a company name placeholder

#### Scenario: No personal data held
- **WHEN** the built `/privacy` page is checked
- **THEN** it says "CryoShield holds no personal data" and does not contain "data controller" or "Data Fiduciary"

## REMOVED Requirements

### Requirement: Grievance Officer
**Reason**: CryoShield holds no personal data, and the founder removed the Grievance Officer section on 2026-10-12.
**Migration**: Privacy questions still go through the GitHub channels in "GitHub-only contact channels".
