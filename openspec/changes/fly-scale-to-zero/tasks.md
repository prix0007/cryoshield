# Tasks

## 1. Scale to zero
- [x] 1.1 Add a deploy test asserting `min_machines_running = 0`, `auto_stop_machines = "suspend"` and `auto_start_machines = true` in `apps/web/fly.toml`. Verify: the test fails against the current config.
- [x] 1.2 Change `apps/web/fly.toml` accordingly. Verify: the test passes and `fly config validate` succeeds.
- [ ] 1.3 After merge and deploy, confirm machines show `suspended` when idle and that a request resumes one with all security headers present. Verify: `fly machines list` and `curl -sI https://cryoshield.app/`.

## 2. Review
- [ ] 2.1 Security review: the change touches no headers, CSP or secrets, and keeps auto-start behaviour. Verify: reviewer note in the PR.
