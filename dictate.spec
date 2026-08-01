# -*- mode: python ; coding: utf-8 -*-
# Freezes dictate.py into a standalone folder so Write Notes can ship dictation to
# machines with no Python installed.
#
# ONEDIR on purpose, not onefile. The Electron app spawns this and waits for
# {"t":"ready"}; onefile would re-extract several hundred MB of ctranslate2 and
# onnxruntime to a temp dir on every single launch before the user could talk.
#
# Model weights are NOT bundled. tiny.en and small.en download into the
# HuggingFace cache on first use, the same way the AutoRecord sibling app does it.
#
# Build:
#   ../AutoRecord/.venv/Scripts/pyinstaller.exe --noconfirm \
#       --distpath dictate-dist --workpath build/dictate dictate.spec
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['pyaudiowpatch']

# Same collect_all set the AutoRecord spec already proved out for ctranslate2's
# DLLs and faster-whisper's bundled Silero VAD assets.
for pkg in ('faster_whisper', 'ctranslate2', 'onnxruntime', 'av', 'tokenizers',
            'huggingface_hub'):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    ['dictate.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='dictate',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,          # the protocol IS stdin/stdout, it must keep real pipes
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='dictate',
)
