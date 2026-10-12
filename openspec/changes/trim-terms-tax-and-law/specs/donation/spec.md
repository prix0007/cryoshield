## MODIFIED Requirements

### Requirement: Donation terms and privacy
`/terms` SHALL state that donations are voluntary, non-refundable and buy no goods or services. It SHALL NOT include a
tax clause. `/privacy` SHALL state that donations are not tracked and that the blockchain is public.

#### Scenario: Legal pages updated
- **WHEN** the built `/terms` and `/privacy` are read
- **THEN** each has a "Donations" section with those statements, `/terms` has no tax clause, and their effective dates have changed
