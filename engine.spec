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
        # keeps the shipped folder small.
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
