# Spec Delta

## Purpose

Defines CryoShield's open-source license, so that anyone can use, audit, fork and run the recovery tooling indefinitely, including if CryoShield ceases to exist.

## ADDED Requirements

### Requirement: MIT license for all first-party code
The repository SHALL include an MIT `LICENSE` file at its root. Every first-party package and source header SHALL declare MIT. This covers Solidity SPDX identifiers, `package.json` `license` fields, and `pyproject.toml` `license`.

#### Scenario: License metadata is consistent
- **WHEN** the repository's first-party license declarations are listed, excluding vendored third-party code such as `contracts/lib/`
- **THEN** each one declares MIT, and a root `LICENSE` file with the MIT text exists

#### Scenario: New package added without a license
- **WHEN** a new first-party package is added without a license declaration
- **THEN** the license consistency check fails until it declares MIT
