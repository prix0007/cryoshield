"""Best-effort handling of secret buffers.

Python cannot guarantee that no copy of a secret survives (immutable ``bytes`` created inside
libraries, the allocator, swap). We keep our own copies in ``bytearray`` and overwrite them as soon as
they are no longer needed, on success and on failure.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

log = logging.getLogger(__name__)


def wipe(buf: bytearray | memoryview | None) -> None:
    if buf is None:
        return
    for i in range(len(buf)):
        buf[i] = 0


def wipe_all(bufs: Iterable[bytearray | None]) -> None:
    for b in bufs:
        wipe(b)


def disable_core_dumps() -> None:
    """Prevent the kernel from writing process memory (including secrets) to a core file."""
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, ValueError, OSError) as e:  # Windows has no resource module
        log.debug("could not disable core dumps: %s", type(e).__name__)
