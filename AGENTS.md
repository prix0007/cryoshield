# AGENTS.md

Working agreement for agents in this repository. **[`CLAUDE.md`](CLAUDE.md) is the source of truth.** It holds the project rules and the step-by-step "Change flow (one PR per change)". This file only lists the rules that are easiest to get wrong.

- **Never push to `main`.** Every change goes through its own branch and pull request:
  - branch;
  - OpenSpec change;
  - TDD build;
  - PR from the template;
  - automatic ECC review (`ecc-review`);
  - fix and push until nothing is blocking;
  - **auto-merge** when every required check passes (the `hold` label is the owner's veto).
- **OpenSpec first.** Code paths without an OpenSpec change fail CI, unless the PR has the `no-spec` label and a justification.
- **Never** add a CryoShield-operated server, never handle plaintext or key material outside the client, and never use asymmetric crypto for vault data. See `openspec/config.yaml`.
- Use small Conventional Commits; the PR title becomes the squash commit.
- Mark your own PR comments with `<!-- claude-pr-flow -->`.
