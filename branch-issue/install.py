#!/usr/bin/env python3
"""Build and install only Branch Issue. Does not edit layouts or key bindings."""
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


def install(app_home, update=False):
    app_home = Path(app_home).expanduser()
    target = app_home / "mods/branch-issue"
    version = json.loads((ROOT / "mods/branch-issue/mod.json").read_text()).get("version", "?")
    previous = None
    installed = {}
    if target.is_symlink():
        raise RuntimeError(f"Refusing to overwrite a symlink: {target}")
    if target.exists():
        try:
            installed = json.loads((target / "mod.json").read_text())
            ours = installed.get("title") == "Branch Issue"
            previous = installed.get("version")
        except (OSError, ValueError):
            ours = False
        if not update or not ours:
            raise RuntimeError(f"{target} already exists; use --update only for an existing Branch Issue install")
    for program in ("go", "herdr-app"):
        if not shutil.which(program):
            raise RuntimeError(f"{program} is required (Go 1.23+ builds the helper)")
    # There are no third-party Go dependencies. Build before touching the install.
    with tempfile.TemporaryDirectory(prefix="branch-issue-build-") as build:
        binary = Path(build) / "herdr-linear"
        subprocess.run(["go", "build", "-o", str(binary), "."], cwd=ROOT / "helper", check=True)
        kept = installed.get("settings") if update else None
        shutil.copytree(ROOT / "mods/branch-issue", target, dirs_exist_ok=update)
        if kept:
            dropped = keep_settings(target / "mod.json", kept)
            if dropped:
                print("Settings no longer used and dropped: " + ", ".join(dropped))
        (target / "bin").mkdir(exist_ok=True)
        shutil.copy2(binary, target / "bin/herdr-linear")
    subprocess.run(["herdr-app", "check", str(target)], check=True)
    change = f" (was {previous or 'unversioned'})" if update else ""
    print(f"Installed Branch Issue {version}{change}: {target}")
    print('Point your sidebar at branch-issue with props {"mode":"branch"}. No layout or keys were changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", default=os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app"))
    parser.add_argument("--update", action="store_true", help="Update an existing Branch Issue installation")
    args = parser.parse_args()
    try:
        install(args.app_home, args.update)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Branch Issue installation failed: {error}\n")


if __name__ == "__main__":
    main()
