"""``cryoshield-recover`` command-line entry point."""

from __future__ import annotations

import argparse
import logging
import math
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TextIO

from . import FORMAT_VERSIONS, __version__
from .authenticator import Fido2PrfSource, PrfSource
from .candidates import Freshness
from .config import (
    CUSTOM_NETWORK,
    DEFAULT_NETWORK,
    NETWORKS,
    PLACEHOLDER_ADDRESS,
    TESTNET,
    Config,
    NetworkPreset,
    is_placeholder,
    parse_address,
    parse_bytes32,
    parse_credential_id,
    preset_for_chain_id,
)
from .errors import ExitCode, RecoveryError
from .net import check_url, host_of
from .recover import VAULT_ID_FOR_FILE, ArweaveFactory, Recovery, RegistryFactory, Result
from .secure import disable_core_dumps, wipe
from .ui import Console, write_new_file

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
    g.add_argument("--registry", metavar="ADDRESS", help="VaultRegistry contract address")
    g.add_argument(
        "--chain-id",
        type=int,
        help="expected chain ID; alone, selects the preset with that ID; otherwise overrides it",
    )
    g.add_argument("--deploy-block", type=int, help="registry deployment block (for event history)")
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
    o.add_argument("--verbose", action="store_true", help="diagnostic output (never includes secrets)")
    return p


def _select_network(a: argparse.Namespace) -> Config:
    """Selection order (target-op-sepolia D2): --network > --testnet > --chain-id matching a preset >
    DEFAULT_NETWORK. A preset's registry is only ever used on that preset's chain (security review):
    a preset plus a conflicting --chain-id is refused, and a non-preset chain ID is a "custom" network
    with no built-in registry and user-supplied --rpc endpoints only."""
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
    else:
        preset = NETWORKS[DEFAULT_NETWORK]
    if preset is None:
        if not a.rpc:
            raise RecoveryError(
                ExitCode.USAGE,
                f"Chain {a.chain_id} is not a built-in network; pass --rpc <url> for it (and --registry), "
                "or choose --network.",
            )
        return Config(
            network=CUSTOM_NETWORK,
            chain_id=a.chain_id,
            registry=PLACEHOLDER_ADDRESS,
            deploy_block=0,
            rpcs=[],
            timeout=a.timeout,
            verbose=a.verbose,
        )
    return Config(
        network=preset.name,
        chain_id=preset.chain_id,
        registry=preset.registry,
        deploy_block=preset.deploy_block,
        rpcs=list(preset.rpcs),
        timeout=a.timeout,
        verbose=a.verbose,
    )


def config_from_args(a: argparse.Namespace) -> Config:
    cfg = _select_network(a)
    try:
        if a.rp_id:
            cfg.rp_id, cfg.rp_id_overridden = a.rp_id, True
        if a.rpc:
            cfg.rpcs = [check_url(u) for u in a.rpc]
            cfg.rpcs_user_supplied = True
        if a.registry:
            cfg.registry = parse_address(a.registry)
        if a.chain_id is not None:
            cfg.chain_id = a.chain_id
        if a.deploy_block is not None:
            cfg.deploy_block = a.deploy_block
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
        if is_placeholder(cfg.registry):
            where = f"custom chain {cfg.chain_id}" if cfg.network == CUSTOM_NETWORK else cfg.network
            ui.warn(
                f"No VaultRegistry deployment is built in for {where} in this release, so blockchain "
                "lookup is off. Pass --registry <address> (and --deploy-block) to use a known deployment, "
                "or --network for another chain."
            )
        else:
            source = "user-supplied" if cfg.rpcs_user_supplied else "built-in"
            contacts.append(
                f"blockchain ({cfg.network}, chain {cfg.chain_id}, registry {cfg.registry}), "
                f"{source} endpoints: " + ", ".join(host_of(u) for u in cfg.rpcs)
            )
    if cfg.arweave_configured:
        contacts.append(
            "Arweave: " + ", ".join(host_of(u) for u in cfg.arweave_graphql + cfg.arweave_gateways)
        )
    if contacts:
        ui.info("Will contact only these public servers (read-only):\n  " + "\n  ".join(contacts))


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
        if cfg.output is None and not ui.interactive:
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
    if cfg.save_blob is not None:
        write_new_file(cfg.save_blob, result.candidate.blob, 0o644)
        ui.info(f"Encrypted vault saved to {cfg.save_blob} (safe to keep; useless without your key).")
    if cfg.output is not None:
        write_new_file(cfg.output, result.secret, 0o600)
        ui.info(f"Secret written to {cfg.output} (readable only by you). Delete it when done.")
    elif ui.confirm_show():
        ui.show_secret(result.secret)
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
        Freshness.UNMATCHED: "This Arweave copy does not match any on-chain version record; it may be outdated.",
    }
    if c.freshness in notes:
        ui.warn(notes[c.freshness])


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
