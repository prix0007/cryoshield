## ADDED Requirements

### Requirement: Parallel desktop and phone E2E
CI SHALL run the web E2E suite as two parallel jobs: a desktop entry (the `chromium` and `analytics` Playwright projects) and a phone entry (the `mobile` and `mobile-small` projects). Together they MUST run every Playwright project. A failure in either entry MUST fail `ci-ok` and MUST NOT cancel the other entry.

#### Scenario: Both shards run on a web change
- **WHEN** a pull request changes a file under `apps/web/`
- **THEN** CI runs the desktop and phone E2E entries in parallel, and between them every Playwright project runs

#### Scenario: Phone failure fails the gate
- **WHEN** a phone E2E spec fails while the desktop entry passes
- **THEN** the desktop entry still completes, and `ci-ok` fails

#### Scenario: Phone shard skips the analytics build
- **WHEN** the phone entry runs
- **THEN** it does not build or serve the analytics preview, and the desktop entry still runs the analytics project against it
