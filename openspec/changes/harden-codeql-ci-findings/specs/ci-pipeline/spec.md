# Spec Delta

## ADDED Requirements

### Requirement: Review workspace holds no PR content at its root
The ECC review workflow (`pull_request_target`) SHALL:
- check out the base commit as the workspace root;
- check out the PR's head commit only into the subdirectory `pr/`, as data that is never executed;
- replace every agent-configuration file in `pr/` with the base commit's version, or remove it. This covers top-level and nested `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/` and `.mcp.json`, plus the top-level startup files.

The reviewing agent SHALL be denied `pr/.git` as well as `.git`. The workflow policy check SHALL refuse:
- a PR-head checkout without `path: pr`;
- a base-commit checkout anywhere but the workspace root.

#### Scenario: PR head checked out at the root
- **WHEN** the PR-head checkout in `ecc-review.yml` has no `path`, or a path other than `pr`
- **THEN** the workflow policy check fails

#### Scenario: PR ships its own agent configuration
- **WHEN** a PR adds or changes `CLAUDE.md`, a nested `CLAUDE.md`, `.claude/` or `.mcp.json`
- **THEN** the reviewing agent sees the base commit's version of that file, or none

### Requirement: Triage comments escape agent text
The issue-triage comment composer SHALL HTML-escape every `<` and `>` in the agent's text, and SHALL break up marker names, before composing the comment. It SHALL NOT rely on a regex strip of comment syntax. No HTML comment, tag or triage marker can then appear in or be re-formed from the agent's part of the comment.

#### Scenario: Split delimiters
- **WHEN** the agent writes `<<!!-- x --<!>` or `<!-- x --!>`
- **THEN** the posted comment shows the characters as text, contains no `<!--`, `-->` or `--!>` in the agent's part, and counts no extra run marker
