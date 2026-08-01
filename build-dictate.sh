#!/bin/bash
# Freeze dictate.py into a standalone folder so Write Notes can ship dictation to
# machines with no Python installed. Output: dictate-dist/dictate/dictate.exe
#
# Uses the AutoRecord venv, which already has every runtime dep plus PyInstaller.
# Takes a couple of minutes: it bundles ctranslate2, onnxruntime and av.
# Whisper model weights are NOT bundled, they download on first use.
#
# Note: call PyInstaller as "python -m PyInstaller", not via pyinstaller.exe.
set -e
cd "$(dirname "$0")"

PY="../AutoRecord/.venv/Scripts/python.exe"
[ -x "$PY" ] || { echo "Build venv missing: $PY" >&2; exit 1; }

"$PY" -m PyInstaller --noconfirm \
    --distpath dictate-dist \
    --workpath build/dictate \
    dictate.spec

echo "==> Built dictate-dist/dictate/dictate.exe"
