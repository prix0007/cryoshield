"""Plain-text terminal interaction. Status goes to stderr; only the secret ever goes to stdout."""

from __future__ import annotations

import getpass
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, TextIO

from .errors import ExitCode, RecoveryError
from .payload import UNKNOWN_VERSION, PayloadError, decode
from .text import display_name, inert_label, inert_secret, sanitize, truncate

if TYPE_CHECKING:
    from .recover import VaultSummary

__all__ = ["Console", "describe", "sanitize", "write_new_file"]

CONFIRM_WORD = "show"


class Console:
    def __init__(
        self,
        stdin: TextIO | None = None,
        stdout: TextIO | None = None,
        stderr: TextIO | None = None,
        *,
        getpass_fn: Callable[[str], str] = getpass.getpass,
        interactive: bool | None = None,
    ) -> None:
        self.stdin = stdin or sys.stdin
        self.stdout = stdout or sys.stdout
        self.stderr = stderr or sys.stderr
        self._getpass = getpass_fn
        self._interactive = interactive

    @property
    def interactive(self) -> bool:
        if self._interactive is not None:
            return self._interactive
        try:
            return self.stdin.isatty() and self.stdout.isatty()
        except (AttributeError, ValueError):
            return False

    def info(self, msg: str) -> None:
        # Status lines can contain remote-sourced text (hosts, error messages, ids): always sanitize.
        print(sanitize(msg), file=self.stderr, flush=True)

    def warn(self, msg: str) -> None:
        print(f"warning: {sanitize(msg)}", file=self.stderr, flush=True)

    def ask_pin(self, retries: int | None) -> str | None:
        suffix = f" ({retries} attempts left)" if retries is not None else ""
        try:
            return self._getpass(f"Enter your security key PIN{suffix}: ") or None
        except (EOFError, KeyboardInterrupt):
            return None

    def pause(self, msg: str) -> None:
        if not self.interactive:
            raise RecoveryError(
                ExitCode.CANCELLED, "Another key is needed, but the tool is not running interactively."
            )
        print(msg + " Press Enter when ready.", file=self.stderr, flush=True)
        if self.stdin.readline() == "":
            raise RecoveryError(ExitCode.CANCELLED, "Cancelled.")

    def choose(self, prompt: str, options: list[str]) -> int:
        """Ask the user to pick one of ``options`` (public metadata only). Non-interactive: refuse."""
        if not self.interactive:
            raise RecoveryError(
                ExitCode.AMBIGUOUS,
                "Several different copies of your vault decrypt and the servers disagree about which is "
                "current. Run interactively to choose, or retry with --rpc pointing at a server you trust.",
            )
        for line in options:
            self.info("  " + line)
        print(
            f"{prompt} Enter a number (1-{len(options)}), or anything else to cancel: ",
            end="",
            file=self.stderr,
            flush=True,
        )
        answer = self.stdin.readline().strip()
        if not (answer.isascii() and answer.isdigit()) or not 1 <= int(answer) <= len(options):
            raise RecoveryError(ExitCode.CANCELLED, "Cancelled: no choice made.")
        return int(answer) - 1

    def confirm_show(self) -> bool:
        self.info(
            "\nYour vault is unlocked. The secret will be printed on this screen.\n"
            "Make sure nobody can see your screen and that no screen recording or sharing is running.\n"
            f'Type "{CONFIRM_WORD}" and press Enter to display it, or anything else to exit without showing it.'
        )
        print("> ", end="", file=self.stderr, flush=True)
        answer = self.stdin.readline()
        return answer.strip() == CONFIRM_WORD

    def show_listing(self, summaries: list[VaultSummary]) -> None:
        """``--list``: one block per vault on stdout. IDs, status (first), names and counts; no labels and
        no secrets."""
        print(f"{len(summaries)} vault(s) open with this key:", file=self.stdout)
        for s in summaries:
            print(f"\n0x{s.vault_id.hex()}", file=self.stdout)
            print(f"  status: {s.state}, {s.freshness_text}", file=self.stdout)
            print(f"  source: {s.source}", file=self.stdout)
            if s.contents == "ok":
                print(f"  {_count(s.items)}, {s.keys}", file=self.stdout)
                print(f"  name: {display_name(s.name)}", file=self.stdout)
            elif s.contents == "locked":
                print(f"  needs {s.keys} to open (insert more keys without --list)", file=self.stdout)
            else:
                what = "made by a newer CryoShield version" if s.contents == "newer-version" else "not a list"
                print(f"  contents: {what}; {s.keys}", file=self.stdout)
        self.stdout.flush()

    def show_vault(self, secret: bytearray) -> None:
        """After confirmation: the vault as ``label: secret`` lines (payload v1/v2), or the raw text for
        a payload this version can't read, so recovery never refuses the user's own data."""
        try:
            p = decode(secret)  # in place: no bytes() copy of the decrypted buffer
        except PayloadError as e:
            if e.code == UNKNOWN_VERSION:
                self.info("This vault was made by a newer version of CryoShield; showing its raw contents.")
            self.show_secret(secret)
            return
        escaped_any = False
        print("\n----- BEGIN SECRETS -----", file=self.stdout)
        print(f"Status: {'ARCHIVED' if p.archived else 'ACTIVE'}", file=self.stdout)
        print(f"Vault: {display_name(p.name)}", file=self.stdout)
        if not p.items:
            print("(no items)", file=self.stdout)
        for item in p.items:
            value, escaped = inert_secret(item.s)
            escaped_any = escaped_any or escaped
            label = inert_label(item.l) or "(no label)"
            if "\n" in value:
                # Every line of a multi-line secret gets a fixed visible prefix, so it can never imitate
                # the tool's framing ("----- END SECRETS -----", "Status: …") (final security review, RT5).
                print(f"{label}:", file=self.stdout)
                for line in value.split("\n"):
                    print(f"  | {line}", file=self.stdout)
            else:
                print(f"{label}: {value}", file=self.stdout)
        print("----- END SECRETS -----", file=self.stdout, flush=True)
        self._escaped_note(escaped_any)
        self._after_show()

    def show_secret(self, secret: bytearray) -> None:
        try:
            body, escaped = inert_secret(secret.decode("utf-8"))
        except UnicodeDecodeError:
            body, escaped = secret.hex(), False
            self.info("(The secret is not text; showing it as hexadecimal.)")
        print("\n----- BEGIN SECRET -----", file=self.stdout)
        for line in body.split("\n"):
            print(f"| {line}", file=self.stdout)  # prefixed: the raw text can't forge the framing (RT5)
        print("----- END SECRET -----", file=self.stdout, flush=True)
        self._escaped_note(escaped)
        self._after_show()

    def _escaped_note(self, escaped: bool) -> None:
        if escaped:
            self.info(
                "Some characters were shown as escapes (\\\\, \\uXXXX) so they can't affect your "
                "screen; use --output for the exact bytes."
            )

    def _after_show(self) -> None:
        self.info(
            "\nWhen you are done, close this window or clear the terminal scrollback "
            "(e.g. 'clear && printf \"\\e[3J\"')."
        )


def _count(n: int | None) -> str:
    return "?" if n is None else f"{n} item{'s' if n != 1 else ''}"


MAX_LABELS_SHOWN = 10
MAX_LABEL_SHOWN = 24


def describe(s: VaultSummary) -> list[str]:
    """Lines about the opened vault that may appear before the confirmation: status (first), name and
    up to MAX_LABELS_SHOWN labels, each at most MAX_LABEL_SHOWN code points. Never a secret value."""
    if s.contents != "ok":
        return []
    lines = [
        f"Status: {s.state}, {s.freshness_text}",
        f"Vault: {display_name(s.name)} ({_count(s.items)}; {s.keys})",
    ]
    if s.labels:
        shown = [truncate(inert_label(label), MAX_LABEL_SHOWN) or "(no label)" for label in s.labels]
        more = len(shown) - MAX_LABELS_SHOWN
        text = ", ".join(shown[:MAX_LABELS_SHOWN]) + (f", +{more} more" if more > 0 else "")
        lines.append("Items: " + text)
    return lines


def write_new_file(path: Path, data: bytes | bytearray, mode: int) -> None:
    """Create ``path`` exclusively (never overwrite, never follow a symlink) with ``mode`` permissions."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(path, flags, mode)
    except FileExistsError:
        raise RecoveryError(
            ExitCode.OUTPUT_REFUSED, f"{path} already exists; refusing to overwrite it."
        ) from None
    except OSError as e:
        raise RecoveryError(ExitCode.OUTPUT_REFUSED, f"Cannot create {path}: {e.strerror}.") from None
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
        os.fsync(fd)
    finally:
        os.close(fd)
