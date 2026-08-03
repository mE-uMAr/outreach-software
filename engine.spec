# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the engine sidecar.

Produces a single-folder build under dist/linkedin-outreach-engine/. A folder
build (rather than --onefile) starts faster and avoids the temp-extraction step
that Windows AV products tend to flag.
"""

from PyInstaller.utils.hooks import collect_submodules

hidden_imports = [
    # Service modules are imported dynamically by load_services(); make sure the
    # whole tree is pulled in even if static analysis misses a branch.
    *collect_submodules("engine.services"),
    *collect_submodules("engine.rpc"),
    *collect_submodules("engine.core"),
    # SQLite: `sqlite3` is pure Python around the `_sqlite3` extension, which in
    # turn loads sqlite3.dll. Naming them keeps the database working on a machine
    # with no Python installed.
    "sqlite3",
    "_sqlite3",
    # httpx pulls these in lazily; without them the AI providers fail only at
    # runtime, inside the packaged build, where it is hardest to diagnose.
    "httpx",
    "httpcore",
    "h11",
    "certifi",
    "idna",
    "sniffio",
    "anyio",
]

analysis = Analysis(
    ["engine/main.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Nothing in the engine draws a UI or crunches arrays; excluding these
        # keeps the shipped folder small. `sqlite3` is NOT excluded — the engine
        # depends on it and it must travel with the binary.
        "tkinter",
        "unittest",
        "pydoc",
        "numpy",
        "pandas",
        "matplotlib",
        "PIL",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="linkedin-outreach-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="linkedin-outreach-engine",
)
