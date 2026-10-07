# Proposal

## Why

The founder asked to suspend the Fly app when it is not in use, to save money. `apps/web/fly.toml` keeps one machine always running (`min_machines_running = 1`, about $2/month), and a second machine exists for zero-downtime deploys. The site is a static file server, so it doesn't need to stay warm.

## What Changes

- `auto_stop_machines = "suspend"`: idle machines are snapshotted to disk and resumed on the next request, which is much faster than a cold start.
- `min_machines_running = 0`: no machine runs while there is no traffic.
- Keep `auto_start_machines = true` and the existing concurrency limits. Concurrency caps how many requests one machine takes before Fly starts the second; the machine count is fixed at 2 (no autoscaling beyond that), which bounds the cost of a traffic flood.

**Out of scope:** CDN, WAF or DDoS changes (tracked separately), and moving region.

**Runtime dependencies:** none added. No CryoShield-operated backend.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `web-hosting`: adds a requirement on idle cost and scale-to-zero.

## Impact

- `apps/web/fly.toml` only.
- **Trade-off:** the first visit after an idle period waits for a resume, typically well under a second for a suspended machine.
