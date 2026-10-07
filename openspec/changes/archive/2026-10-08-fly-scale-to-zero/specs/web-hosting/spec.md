# Spec Delta

## ADDED Requirements

### Requirement: Scale to zero when idle
The Fly app SHALL run no machines while it receives no traffic: `min_machines_running` SHALL be 0, `auto_stop_machines` SHALL be `"suspend"` and `auto_start_machines` SHALL be true. The app SHALL NOT autoscale beyond its fixed machine count, so a traffic flood cannot multiply compute cost.

#### Scenario: Idle site
- **WHEN** the site receives no requests for the platform's idle window
- **THEN** every machine is suspended and the app incurs no machine-time cost

#### Scenario: First visit after idle
- **WHEN** a request arrives while all machines are suspended
- **THEN** Fly resumes a machine and serves the request with the same headers as a warm machine

#### Scenario: Config drift
- **WHEN** `fly.toml` sets `min_machines_running` above 0 or `auto_stop_machines` to anything other than `"suspend"`
- **THEN** the deploy test suite fails
