# Spec Delta

## ADDED Requirements

### Requirement: Agents act through a non-admin machine account
Automated agents SHALL push branches, open pull requests and comment as a dedicated machine account. That account SHALL have the Write role and a fine-grained token scoped to this repository, without administration permission. The owner's admin credentials SHALL NOT be used by agents, so rulesets and environment approvals bind them.

#### Scenario: Agent tries to change protection
- **WHEN** an agent using the machine account calls the rulesets or environments API to change protection
- **THEN** GitHub refuses the call for lack of administration permission
