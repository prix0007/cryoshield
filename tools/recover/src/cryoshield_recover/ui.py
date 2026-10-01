"""Plain-text terminal interaction. Status goes to stderr; only the secret ever goes to stdout."""

from __future__ import annotations

import getpass
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TextIO

from .errors import ExitCode, RecoveryError
from .text import sanitize

__all__ = ["Console", "sanitize", "write_new_file"]

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

    def confirm_show(self) -> bool:
        self.info(
            "\nYour vault is unlocked. The secret will be printed on this screen.\n"
            "Make sure nobody can see your screen and that no screen recording or sharing is running.\n"
            f'Type "{CONFIRM_WORD}" and press Enter to display it, or anything else to exit without showing it.'
        )
        print("> ", end="", file=self.stderr, flush=True)
        answer = self.stdin.readline()
        return answer.strip() == CONFIRM_WORD

    def show_secret(self, secret: bytearray) -> None:
        try:
            text = bytes(secret).decode("utf-8")
            body = text
        except UnicodeDecodeError:
            body = bytes(secret).hex()
            self.info("(The secret is not text; showing it as hexadecimal.)")
        print("\n----- BEGIN SECRET -----", file=self.stdout)
        print(body, file=self.stdout)
        print("----- END SECRET -----", file=self.stdout, flush=True)
        self.info(
            "\nWhen you are done, close this window or clear the terminal scrollback "
            "(e.g. 'clear && printf \"\\e[3J\"')."
        )


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
