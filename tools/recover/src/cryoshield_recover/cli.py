"""``cryoshield-recover`` command-line entry point."""

from __future__ import annotations

import argparse
import dataclasses
import logging
import math
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TextIO

from . import FORMAT_VERSIONS, __version__
from .authenticator import Fido2PrfSource, PrfSource
from .candidates import Candidate, Freshness
from .config import (
    BUILT_IN,
    CUSTOM_NETWORK,
    DEFAULT_NETWORK,
    FLAG_SOURCE,
    MAX_BLOCK,
    NETWORKS,
    REGISTRY_FORM,
    TESTNET,
    Config,
    NetworkPreset,
    RegistryFlag,
    RegistrySpec,
    combine_registries,
    parse_address,
    parse_bytes32,
    parse_credential_id,
    parse_registry_flag,
    preset_for_chain_id,
    resolve_flags,
)
from .deployments import load_file
from .errors import ExitCode, RecoveryError
from .net import check_url, host_of
from .recover import VAULT_ID_FOR_FILE, ArweaveFactory, Recovery, RegistryFactory, Result
from .secure import disable_core_dumps, wipe
from .ui import Console, describe, write_new_file

EXIT_CODES_HELP = "\n".join(f"  {c.value:>2}  {c.name.lower().replace('_', ' ')}" for c in ExitCode)


MAX_TIMEOUT = 300.0


def _timeout(text: str) -> float:
    """--timeout: a finite number of seconds in (0, 300] (audit INFO: 'inf'/'nan' were accepted)."""
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a number: {text!r}") from None
    if not math.isfinite(value) or not 0 < value <= MAX_TIMEOUT:
        raise argparse.ArgumentTypeError(f"must be a finite number of seconds in (0, {MAX_TIMEOUT:g}]")
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cryoshield-recover",
        description=(
            "Unlock your CryoShield vault with only your hardware key. Works without the CryoShield "
            "website: it reads your encrypted vault from public blockchain servers or Arweave and "
            "decrypts it on this computer."
        ),
        epilog="exit codes:\n" + EXIT_CODES_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="store_true", help="print version and supported vault formats")
    g = p.add_argument_group("where to look")
    g.add_argument("--network", choices=sorted(NETWORKS), help=f"chain preset (default: {DEFAULT_NETWORK})")
    g.add_argument("--testnet", action="store_true", help=f"shorthand for --network {TESTNET}")
    g.add_argument(
        "--rpc", action="append", metavar="URL", help="JSON-RPC endpoint (repeatable; replaces defaults)"
    )
    g.add_argument(
        "--registry",
        action="append",
        metavar="ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]",
        help="also read this VaultRegistry deployment (repeatable), e.g. 0x…@123:v3:abi=v2. It ranks below "
        "the built-in registries unless it equals one. Without :vN an unknown address is read as v1",
    )
    g.add_argument(
        "--registries-only",
        action="store_true",
        help="use only the --registry and --deployment-file entries, not the network's built-in registries",
    )
    g.add_argument(
        "--trust-custom-registries",
        action="store_true",
        help="let supplied registries rank by version and vouch for a copy (only for a newer official "
        "deployment this release does not know; see the README)",
    )
    g.add_argument(
        "--deployment-file",
        type=Path,
        metavar="PATH",
        help="use every registry in a saved deployment record (contracts/deployments/<chainId>.json) or "
        "release file (/release.json); its chain ID selects the network",
    )
    g.add_argument("--registry-v2", metavar="ADDRESS", help="deprecated: use --registry ADDRESS@BLOCK:v2")
    g.add_argument(
        "--chain-id",
        type=int,
        help="expected chain ID; alone, selects the preset with that ID; otherwise overrides it",
    )
    g.add_argument("--deploy-block", type=int, help="deprecated: use --registry ADDRESS@BLOCK:v1")
    g.add_argument("--deploy-block-v2", type=int, help="deprecated: use --registry ADDRESS@BLOCK:v2")
    g.add_argument(
        "--arweave-graphql", action="append", metavar="URL", help="Arweave GraphQL endpoint (repeatable)"
    )
    g.add_argument(
        "--arweave-gateway", action="append", metavar="URL", help="Arweave data gateway (repeatable)"
    )
    g.add_argument("--no-arweave", action="store_true", help="do not use the Arweave fallback")
    g.add_argument("--no-chain", action="store_true", help="do not query blockchain servers")
    g.add_argument(
        "--timeout", type=_timeout, default=10.0, help="network timeout in seconds (default 10, max 300)"
    )
    k = p.add_argument_group("which vault / key")
    k.add_argument("--rp-id", help="site the key was registered with (default: built-in; a vault's own wins)")
    k.add_argument("--vault-id", metavar="HEX", help="vault ID (for keys without a discoverable credential)")
    k.add_argument("--credential-id", action="append", metavar="ID", help="credential ID, hex or base64url")
    k.add_argument(
        "--blob-file", type=Path, metavar="PATH", help="saved vault file (raw bytes or hex); needs --vault-id"
    )
    k.add_argument(
        "--offline", action="store_true", help="no network at all (requires --blob-file and --vault-id)"
    )
    o = p.add_argument_group("output")
    o.add_argument("--output", type=Path, metavar="PATH", help="write the secret to a NEW file (mode 0600)")
    o.add_argument(
        "--save-blob", type=Path, metavar="PATH", help="also save the encrypted vault for offline use"
    )
    o.add_argument(
        "--list",
        action="store_true",
        help="list every vault this key opens (ID, name, status, counts) and exit; shows no labels or secrets",
    )
    o.add_argument("--verbose", action="store_true", help="diagnostic output (never includes secrets)")
    return p


def _select_network(
    a: argparse.Namespace, file_chain_id: int | None = None
) -> tuple[Config, NetworkPreset | None]:
    """Selection order (target-op-sepolia D2): --network > --testnet > --chain-id matching a preset >
    a --deployment-file's chain ID > DEFAULT_NETWORK. A preset's registries are only ever used on that
    preset's chain (security review): a preset plus a conflicting --chain-id or deployment file is
    refused, and a non-preset chain ID is a "custom" network with no built-in registry and user-supplied
    --rpc endpoints only."""
    explicit = a.network or (TESTNET if a.testnet else None)
    preset: NetworkPreset | None
    if explicit is not None:
        preset = NETWORKS[explicit]
        if a.chain_id is not None and a.chain_id != preset.chain_id:
            raise RecoveryError(
                ExitCode.USAGE,
                f"--chain-id {a.chain_id} conflicts with network {explicit} (chain {preset.chain_id}). "
                "Drop --chain-id, or for a custom chain use --chain-id with --rpc and --registry "
                "(without --network/--testnet).",
            )
    elif a.chain_id is not None:
        preset = preset_for_chain_id(a.chain_id)
    elif file_chain_id is not None:
        preset = preset_for_chain_id(file_chain_id)
    else:
        preset = NETWORKS[DEFAULT_NETWORK]
    chain_id = a.chain_id if a.chain_id is not None else file_chain_id
    if file_chain_id is not None:
        selected = preset.chain_id if preset is not None else chain_id
        if selected != file_chain_id:
            raise RecoveryError(
                ExitCode.USAGE,
                f"The deployment file is for chain {file_chain_id}, but the selected network is chain "
                f"{selected}. Drop --network/--testnet/--chain-id, or use the file for this chain.",
            )
    if preset is None:
        if not a.rpc:
            raise RecoveryError(
                ExitCode.USAGE,
                f"Chain {chain_id} is not a built-in network; pass --rpc <url> for it (and --registry), "
                "or choose --network.",
            )
        if chain_id is None:  # unreachable: no preset only with --chain-id or a deployment file
            raise RecoveryError(ExitCode.USAGE, "Pass --network or --chain-id.")
        return (
            Config(
                network=CUSTOM_NETWORK,
                chain_id=chain_id,
                registries=[],
                rpcs=[],
                timeout=a.timeout,
                verbose=a.verbose,
            ),
            None,
        )
    return (
        Config(
            network=preset.name,
            chain_id=preset.chain_id,
            registries=list(preset.registries),
            rpcs=list(preset.rpcs),
            timeout=a.timeout,
            verbose=a.verbose,
        ),
        preset,
    )


def _registries(a: argparse.Namespace, cfg: Config, file_specs: list[RegistrySpec] | None) -> None:
    """The final registry list (recover-registry-versions D7, D8, D10, D11).

    Supplied entries are the deployment file's, overlaid by --registry entries of the same version, then
    the deprecated block flags. ``combine_registries`` keeps every built-in entry (unless
    --registries-only), turns a supplied entry equal to a built-in one into that built-in entry, refuses
    a raised built-in block, and adds the rest untrusted. Raises ValueError (a usage error)."""
    builtin = list(cfg.registries)
    if a.registries_only and not (a.registry or a.registry_v2 or file_specs):
        raise ValueError(
            "--registries-only needs at least one --registry ADDRESS[@DEPLOY_BLOCK]:vN or a --deployment-file"
        )
    supplied: dict[int, RegistrySpec] = {s.version: s for s in file_specs or []}
    flags: list[RegistryFlag] = [parse_registry_flag(text) for text in a.registry or []]
    if a.registry_v2:
        try:
            flags.append(RegistryFlag(parse_address(a.registry_v2), None, 2, None))
        except ValueError as e:
            raise ValueError(f"--registry-v2: {e}") from None
    from_flags, notes = resolve_flags([*builtin, *supplied.values()], flags)
    supplied.update({s.version: s for s in from_flags})
    for flag, version, block in (
        ("--deploy-block-v2", 2, a.deploy_block_v2),
        ("--deploy-block", 1, a.deploy_block),
    ):
        if block is None:
            continue
        if not 0 <= block < MAX_BLOCK:
            raise ValueError(f"{flag} must be a whole number from 0 to {MAX_BLOCK - 1}")
        target = supplied.get(version) or next((s for s in builtin if s.version == version), None)
        if target is None or (a.registries_only and version not in supplied):
            raise ValueError(f"{flag} sets registry v{version}'s block, but no registry v{version} is in use")
        supplied[version] = dataclasses.replace(
            target, deploy_block=block, block_known=True, source=FLAG_SOURCE, trusted=False
        )
        notes.append(f"{flag} is deprecated; use --registry {target.address}@{block}:v{version} instead.")
    if a.registry_v2 and a.deploy_block_v2 is None:
        notes.append(f"--registry-v2 is deprecated; use --registry {supplied[2].address}@BLOCK:v2 instead.")
    cfg.registries = combine_registries(
        builtin, list(supplied.values()), only=a.registries_only, trust_custom=a.trust_custom_registries
    )
    cfg.trust_custom = a.trust_custom_registries
    cfg.notes.extend(notes)
    kept = {(s.version, s.address) for s in cfg.registries}
    cfg.dropped_builtin = [s.version for s in builtin if (s.version, s.address) not in kept]


def config_from_args(a: argparse.Namespace) -> Config:
    file_chain_id: int | None = None
    file_specs: list[RegistrySpec] | None = None
    if a.deployment_file is not None:
        try:
            file_chain_id, file_specs = load_file(a.deployment_file)
        except ValueError as e:
            raise RecoveryError(ExitCode.USAGE, f"--deployment-file: {e}") from None
    cfg, _preset = _select_network(a, file_chain_id)
    try:
        if a.rp_id:
            cfg.rp_id, cfg.rp_id_overridden = a.rp_id, True
        if a.rpc:
            cfg.rpcs = [check_url(u) for u in a.rpc]
            cfg.rpcs_user_supplied = True
        if a.chain_id is not None:
            cfg.chain_id = a.chain_id
        # A preset's deploy block belongs to the preset's address. For another address without its own
        # block, history is scanned from block 0 (slower, never wrong) rather than possibly skipping that
        # deployment's first events, which would make its history look empty (ECC review, PR #40).
        _registries(a, cfg, file_specs)
        if a.arweave_graphql:
            cfg.arweave_graphql = [check_url(u) for u in a.arweave_graphql]
        if a.arweave_gateway:
            cfg.arweave_gateways = [check_url(u) for u in a.arweave_gateway]
        if a.vault_id:
            cfg.vault_id = parse_bytes32(a.vault_id)
        if a.credential_id:
            cfg.credential_ids = [parse_credential_id(c) for c in a.credential_id]
    except ValueError as e:
        raise RecoveryError(ExitCode.USAGE, str(e)) from None
    cfg.use_arweave = not a.no_arweave
    cfg.use_chain = not a.no_chain
    cfg.blob_file = a.blob_file
    cfg.offline = a.offline
    cfg.output = a.output
    cfg.save_blob = a.save_blob
    for path in (cfg.output, cfg.save_blob):
        if path is not None and (path.exists() or path.is_symlink()):
            raise RecoveryError(ExitCode.OUTPUT_REFUSED, f"{path} already exists; refusing to overwrite it.")
    if cfg.offline and cfg.blob_file is None:
        raise RecoveryError(ExitCode.USAGE, "--offline needs --blob-file (a saved copy of your vault).")
    if cfg.blob_file is not None and cfg.vault_id is None:
        raise RecoveryError(ExitCode.USAGE, VAULT_ID_FOR_FILE)
    if cfg.credential_ids and (cfg.blob_file is not None or cfg.vault_id is not None):
        raise RecoveryError(
            ExitCode.USAGE, "--credential-id cannot be combined with --vault-id or --blob-file."
        )
    return cfg


def startup_summary(cfg: Config, ui: Console) -> None:
    ui.info(f"CryoShield recovery {__version__}. Site (RP ID): {cfg.rp_id}")
    if cfg.offline:
        ui.info("Offline mode: no network connections will be made.")
        return
    ui.info(f"Network: {cfg.network} (chain {cfg.chain_id})")
    contacts = []
    if cfg.use_chain:
        if not cfg.has_registry:
            where = f"custom chain {cfg.chain_id}" if cfg.network == CUSTOM_NETWORK else cfg.network
            ui.warn(
                f"No VaultRegistry deployment is built in for {where} in this release, so blockchain "
                f"lookup is off. Pass {REGISTRY_FORM} (repeatable) or --deployment-file <saved record> "
                "to use a known deployment (the older --registry-v2/--registry flags still work), or "
                "--network for another chain."
            )
        else:
            _registry_summary(cfg, ui)
            source = "user-supplied" if cfg.rpcs_user_supplied else "built-in"
            count = len(cfg.registries)
            contacts.append(
                f"blockchain ({cfg.network}, chain {cfg.chain_id}, {count} "
                f"registr{'y' if count == 1 else 'ies'}), {source} endpoints: "
                + ", ".join(host_of(u) for u in cfg.rpcs)
            )
    if cfg.arweave_configured:
        contacts.append(
            "Arweave: " + ", ".join(host_of(u) for u in cfg.arweave_graphql + cfg.arweave_gateways)
        )
    if contacts:
        ui.info("Will contact only these public servers (read-only):\n  " + "\n  ".join(contacts))


def _registry_summary(cfg: Config, ui: Console) -> None:
    """Every registry, newest first, with its source (D9). Public values only."""
    ui.info(
        "Registries (built-in first, newest first):\n  "
        + "\n  ".join(
            f"registry {s.label} {s.address} from block {s.deploy_block} "
            f"({s.source if s.source.startswith('from ') or s.source == BUILT_IN else 'from ' + s.source})"
            + (f", read with the v{s.abi_kind} ABI" if s.abi_kind != s.version else "")
            for s in cfg.registries
        )
    )
    for note in cfg.notes:
        ui.info(f"Note: {note}")
    for s in cfg.registries:
        if not s.block_known:
            ui.warn(
                f"No deployment block is known for registry {s.name} ({s.address}), so its update history "
                "is searched from block 0, which can be slow or fail on public servers. If you know it, "
                f"pass --registry {s.address}@BLOCK:{s.name}."
            )
    if cfg.dropped_builtin:
        names = ", ".join(f"v{v}" for v in cfg.dropped_builtin)
        ui.warn(
            f"Built-in registry {names} of {cfg.network} is not used in this run, so copies elsewhere cannot "
            "be checked against it and an older copy may look current."
        )
    supplied = [s for s in cfg.registries if s.source != BUILT_IN]
    if any(not s.trusted for s in supplied):
        ui.warn(
            "SECURITY: you supplied a registry that is not built into this release. It is read AFTER the "
            "built-in registries and can never make a copy count as current: a wrong address (for example "
            "from a phishing message) could otherwise show you an OLDER version of your secrets. A copy found "
            "only there is shown with a warning."
        )
    if any(s.trusted for s in supplied):
        why = (
            "--trust-custom-registries is set"
            if cfg.trust_custom
            else f"this release has no built-in registry for {cfg.network}"
        )
        ui.warn(
            f"SECURITY: {why}, so the registries you supplied decide which copy of your vault is current. "
            "A wrong address can show you an OLDER version of your secrets. Use only addresses from the "
            "project's deployment records or another source you trust."
        )


def _configure_logging(verbose: bool, stream: TextIO) -> None:
    """Diagnostics go to our own logger only; only public values are ever logged."""
    logger = logging.getLogger("cryoshield_recover")
    for h in [h for h in logger.handlers if getattr(h, "_cryoshield", False)]:
        logger.removeHandler(h)
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("debug: %(name)s: %(message)s"))
    setattr(handler, "_cryoshield", True)  # noqa: B010 - tag our handler for idempotent setup
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG if verbose else logging.WARNING)
    # python-fido2 debug logs include raw CTAP frames; keep them quiet even in verbose mode.
    logging.getLogger("fido2").setLevel(logging.WARNING)


def main(
    argv: Sequence[str] | None = None,
    *,
    console: Console | None = None,
    prf_factory: Callable[[Console], PrfSource] | None = None,
    registry_factory: RegistryFactory | None = None,
    arweave_factory: ArweaveFactory | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    ui = console or Console()
    if args.version:
        print(f"cryoshield-recover {__version__} (vault format v{', v'.join(map(str, FORMAT_VERSIONS))})")
        return ExitCode.OK
    _configure_logging(args.verbose, ui.stderr)
    disable_core_dumps()
    secret = None
    recovery: Recovery | None = None
    try:
        cfg = config_from_args(args)
        if args.list and (cfg.output is not None or cfg.save_blob is not None):
            raise RecoveryError(
                ExitCode.USAGE, "--list shows no secrets and writes no files; drop --output and --save-blob."
            )
        if cfg.output is None and not ui.interactive and not args.list:
            raise RecoveryError(
                ExitCode.OUTPUT_REFUSED,
                "Refusing to print a secret when not attached to a terminal. Use --output <new file> instead.",
            )
        startup_summary(cfg, ui)
        prf = (prf_factory or Fido2PrfSource)(ui)
        factories: dict[str, Any] = {}
        if registry_factory is not None:
            factories["registry_factory"] = registry_factory
        if arweave_factory is not None:
            factories["arweave_factory"] = arweave_factory
        recovery = Recovery(cfg, prf, ui, **factories)
        if args.list:
            summaries = recovery.list_vaults()
            for w in recovery.warnings():
                ui.warn(w)
            ui.show_listing(summaries)
            return ExitCode.OK
        result = recovery.run()
        secret = result.secret
        _emit(result, cfg, ui)
        return ExitCode.OK
    except RecoveryError as e:
        if recovery is not None:
            for w in recovery.warnings():
                ui.warn(w)
        ui.info(f"\n{e.message}")
        return e.exit_code
    except KeyboardInterrupt:
        ui.info("\nCancelled.")
        return ExitCode.CANCELLED
    except Exception as e:  # noqa: BLE001 - last-resort, secret-free message
        ui.info(f"\nUnexpected error ({type(e).__name__}). Please report it; no secret was shown or saved.")
        if args.verbose:
            logging.getLogger(__name__).debug("unexpected error type: %s", type(e).__qualname__)
        return ExitCode.INTERNAL
    finally:
        wipe(secret)


def _emit(result: Result, cfg: Config, ui: Console) -> None:
    """Report what was found, then save and/or reveal the secret as the user asked."""
    for w in result.warnings:
        ui.warn(w)
    _report(result, ui)
    caveat = _untrusted_caveat(result.candidate)
    if cfg.save_blob is not None:
        write_new_file(cfg.save_blob, result.candidate.blob, 0o644)
        ui.info(f"Encrypted vault saved to {cfg.save_blob} (safe to keep; useless without your key).")
        if caveat:
            ui.warn(f"The saved copy {caveat}")
    if cfg.output is not None:
        write_new_file(cfg.output, result.secret, 0o600)
        ui.info(f"Secret written to {cfg.output} (readable only by you). Delete it when done.")
        if caveat:
            ui.warn(f"The secret written {caveat}")
    elif ui.confirm_show():
        ui.show_vault(result.secret)
    else:
        ui.info("Not shown. Nothing was written anywhere.")


def _report(result: Result, ui: Console) -> None:
    c = result.candidate
    where = {"chain": "the blockchain", "arweave": "the Arweave archive", "file": "your file"}[c.source]
    ui.info(f"\nUnlocked a vault found on {where} ({c.origin}).")
    if c.vault_id is not None:
        ui.info(
            f"Vault ID: 0x{c.vault_id.hex()}  (write this down; it allows recovery without a discoverable key)"
        )
    if result.ignored:
        ui.info(
            f"Ignored {result.ignored} other candidate(s) that this key cannot open (normal; anyone can add junk)."
        )
    notes = {
        Freshness.OUTDATED: "This is an OLDER version of your vault; a newer one exists on-chain.",
        Freshness.UNVERIFIABLE: "Could not confirm that this is the latest version of your vault (no agreed on-chain record).",
        Freshness.UNMATCHED: "This copy does not match any on-chain version record; it may be outdated.",
    }
    if c.freshness in notes:
        ui.warn(notes[c.freshness])
    caveat = _untrusted_caveat(c)
    if caveat:
        ui.warn(f"SECURITY: this copy {caveat}")
    if result.summary is not None:
        for line in describe(result.summary):
            ui.info(line)


def _untrusted_caveat(c: Candidate) -> str:
    """The result-time warning for a copy from a supplied, untrusted registry (D10)."""
    if not c.untrusted:
        return ""
    return (
        f"came from {c.untrusted}, a registry you supplied that is not built into this release. It was "
        "not trusted to say which version is current: it may be OLDER than your latest vault."
    )


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
