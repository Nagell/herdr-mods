#!/usr/bin/env python3
"""Build and install only hands. Does not edit layouts or key bindings."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def keep_settings(manifest, kept, prefix=""):
    """Write a person's settings into the new manifest; keys the new version lacks are returned."""
    fresh = json.loads(manifest.read_text())
    dropped = []

    def merge(defaults, given, path):
        for key, value in given.items():
            name = f"{path}.{key}" if path else key
            if key not in defaults:
                dropped.append(name)
            elif isinstance(defaults[key], dict) and isinstance(value, dict):
                merge(defaults[key], value, name)
            else:
                defaults[key] = value

    merge(fresh.setdefault("settings", {}), kept, prefix)
    manifest.write_text(json.dumps(fresh, indent=2) + "\n")
    return dropped


def install(app_home, update=False, link_dir="~/.local/bin"):
    app_home = Path(app_home).expanduser()
    target = app_home / "mods/hands"
    version = json.loads((ROOT / "mods/hands/mod.json").read_text()).get("version", "?")
    previous = None
    installed = {}
    if target.is_symlink():
        raise RuntimeError(f"Refusing to overwrite a symlink: {target}")
    if target.exists():
        try:
            installed = json.loads((target / "mod.json").read_text())
            ours = installed.get("title") == "hands"
            previous = installed.get("version")
        except (OSError, ValueError):
            ours = False
        if not update or not ours:
            raise RuntimeError(f"{target} already exists; use --update only for an existing hands install")
    for program in ("go", "clang", "herdr-app"):
        if not shutil.which(program):
            raise RuntimeError(f"{program} is required (Go 1.23+ and the Xcode command line tools build the helper)")
    # No third-party dependencies: cgo compiles the Objective-C bridge with the system frameworks.
    with tempfile.TemporaryDirectory(prefix="hands-build-") as build:
        binary = Path(build) / "hands"
        subprocess.run(["go", "build", "-o", str(binary), "."], cwd=ROOT / "helper", check=True, env={**os.environ, "CGO_ENABLED": "1"})
        kept = installed.get("settings") if update else None
        shutil.copytree(ROOT / "mods/hands", target, dirs_exist_ok=update)
        if kept:
            dropped = keep_settings(target / "mod.json", kept)
            if dropped:
                print("Settings no longer used and dropped: " + ", ".join(dropped))
        (target / "bin").mkdir(exist_ok=True)
        # A new file, not a rewrite: macOS kills a signed binary changed in place.
        fresh = target / "bin/.hands.new"
        shutil.copy2(binary, fresh)
        os.replace(fresh, target / "bin/hands")
    subprocess.run(["herdr-app", "check", str(target)], check=True)
    change = f" (was {previous or 'unversioned'})" if update else ""
    print(f"Installed hands {version}{change}: {target}")
    # Agents in Herdr terminals find `hands` on PATH through this link.
    link = Path(link_dir).expanduser() / "hands"
    if link.exists() and not link.is_symlink():
        print(f"Not linking: {link} exists and is not a symlink. Add {target / 'bin'} to PATH instead.")
    else:
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink():
            link.unlink()
        link.symlink_to(target / "bin/hands")
        print(f"Linked {link} -> {target / 'bin/hands'}")
        if str(link.parent) not in os.environ.get("PATH", "").split(os.pathsep):
            print(f"{link.parent} is not on PATH; add it so `hands` resolves in terminals.")
    print("Run `hands permissions --ask` from a Herdr terminal to grant Accessibility and Screen Recording to Herdr.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", default=os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app"))
    parser.add_argument("--update", action="store_true", help="Update an existing hands installation")
    parser.add_argument("--link-dir", default="~/.local/bin", help="Where to symlink the hands binary")
    args = parser.parse_args()
    try:
        install(args.app_home, args.update, args.link_dir)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"hands installation failed: {error}\n")


if __name__ == "__main__":
    main()
