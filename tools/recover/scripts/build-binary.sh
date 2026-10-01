#!/usr/bin/env bash
# Reproducible single-file build of cryoshield-recover.
#
#   scripts/build-binary.sh            build natively into dist/ (prints SHA-256)
#   scripts/build-binary.sh --docker [--check]   build inside a pinned Linux image (the release path)
#   scripts/build-binary.sh --check    build twice from scratch and fail if the hashes differ
#
# Inputs are pinned: Python version, every dependency hash (uv.lock), PyInstaller (dependency group
# "build"), SOURCE_DATE_EPOCH, and PYTHONHASHSEED. Bit-for-bit reproducibility is guaranteed only for
# the Linux --docker build; macOS/Windows builds are best effort (see README "Verifying a download").
# The binary supports USB keys only (NFC/PC-SC needs pyscard: install with pipx "cryoshield-recover[nfc]").
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

PYTHON_VERSION="${PYTHON_VERSION:-3.12.11}"
# Base image pinned by digest (multi-arch manifest list), so the toolchain cannot drift silently.
IMAGE="${BUILD_IMAGE:-python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7}"
# uv is installed inside the container from PyPI with pip --require-hashes (both Linux arches).
UV_REQ="uv==0.7.19 --hash=sha256:5dee2c73fe29e8f119ac074ebb3b2aa4390272e5ab3a5f00f75ca16caf120d64 --hash=sha256:52b7d64a97b18196cccbbbd8036ad649a72b7b1a7fd4b22297219c55a733127c"
# PyInstaller needs objdump; exact Debian version (apt verifies the signed repository). If Debian
# publishes a new revision the build fails loudly instead of silently using a different toolchain.
BINUTILS_VERSION="${BINUTILS_VERSION:-2.40-2}"

if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  SOURCE_DATE_EPOCH="$(git log -1 --format=%ct 2>/dev/null || echo 1767225600)"
fi
export SOURCE_DATE_EPOCH PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

build_native() {
  local out="${1:-dist}"
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  UV_PROJECT_ENVIRONMENT="$work/venv" uv sync --frozen --no-dev --group build --python "$PYTHON_VERSION" --quiet
  "$work/venv/bin/pyinstaller" \
    --onefile --clean --noconfirm --log-level WARN \
    --name cryoshield-recover \
    --collect-data fido2 \
    --exclude-module fido2.pcsc --exclude-module smartcard \
    --distpath "$out" --workpath "$work/build" --specpath "$work" \
    scripts/entry.py
  local bin="$out/cryoshield-recover"
  [[ -f "$bin.exe" ]] && bin="$bin.exe"
  "$bin" --version
  sha256 "$bin" | tee "$bin.sha256"
}

case "${1:-}" in
  --docker)
    # Copy the source into the container so host build artifacts (.venv, dist) never leak in.
    docker run --rm -e SOURCE_DATE_EPOCH -e PYTHON_VERSION -v "$HERE":/host:ro -v "$HERE/dist":/out "$IMAGE" bash -c "
      set -e
      apt-get update -qq && apt-get install -y -qq --no-install-recommends binutils=$BINUTILS_VERSION >/dev/null
      echo '$UV_REQ' > /tmp/uv-requirements.txt
      pip install --quiet --root-user-action=ignore --require-hashes -r /tmp/uv-requirements.txt
      mkdir /src && cd /host && tar --exclude=.venv --exclude=dist --exclude=.pytest_cache -cf - . | tar -xf - -C /src
      cd /src && scripts/build-binary.sh ${2:-} && cp -r dist/. /out/"
    ;;
  --check)
    build_native dist/a >/dev/null
    build_native dist/b >/dev/null
    a="$(sha256 dist/a/cryoshield-recover* | grep -v '\.sha256' | awk '{print $1}')"
    b="$(sha256 dist/b/cryoshield-recover* | grep -v '\.sha256' | awk '{print $1}')"
    echo "build a: $a"
    echo "build b: $b"
    [[ "$a" == "$b" ]] || { echo "NOT REPRODUCIBLE" >&2; exit 1; }
    echo "reproducible"
    ;;
  *)
    build_native dist
    ;;
esac
