# Spec Delta

## ADDED Requirements

### Requirement: Container image and filesystem vulnerability scan
On every pull request, CI MUST run Trivy, pinned by version and SHA-256, over: every committed lockfile in the checkout; the base image named by the web Dockerfile's first `FROM` line, which MUST be pinned by digest; and the Dockerfile's configuration. The gate MUST fail on any CRITICAL, HIGH or unknown-severity vulnerability and on any CRITICAL or HIGH misconfiguration, and MUST report lower severities without failing. A scanner error MUST fail the run. Exceptions MUST be listed in a committed ignore file in the scanner's native format, each with an id, a statement and an expiry at most 90 days ahead, and every excepted id MUST appear in the README's known-vulnerabilities section.

#### Scenario: HIGH vulnerability in the base image
- **WHEN** the digest-pinned base image carries a package with a HIGH vulnerability that is not in the ignore file
- **THEN** `pr-checks` fails and names the target, package, version and advisory

#### Scenario: Medium-severity findings only
- **WHEN** the only findings are MEDIUM or LOW
- **THEN** the scan reports them and passes

#### Scenario: Unknown severity
- **WHEN** a finding has no severity in the database
- **THEN** it blocks, like an unscored osv-scanner finding

#### Scenario: Expired exception
- **WHEN** an ignore entry's `expired_at` has passed
- **THEN** the finding counts again and fails the scan

#### Scenario: Exception missing from the README
- **WHEN** the ignore file lists an id that the README's known-vulnerabilities section does not mention
- **THEN** the gate fails and names the id

#### Scenario: Base image without a digest
- **WHEN** the Dockerfile's `FROM` line names a tag without `@sha256:`
- **THEN** the scan step fails before pulling anything

#### Scenario: Ignore file outside the accepted shape
- **WHEN** the ignore file contains a key other than `vulnerabilities` or `misconfigurations`, an entry without a statement or expiry, an expiry more than 90 days ahead, or a YAML anchor, alias or tag
- **THEN** the gate fails and names the line
