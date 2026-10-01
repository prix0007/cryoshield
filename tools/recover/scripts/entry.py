"""PyInstaller entry point (a plain script; the package's __main__ uses relative imports)."""

from cryoshield_recover.cli import main

raise SystemExit(main())
