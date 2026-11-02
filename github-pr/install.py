#!/usr/bin/env python3
"""Build and install only GitHub PR. Does not edit layouts or key bindings."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def install(app_home, update=False):
    app_home = Path(app_home).expanduser()
    target = app_home / "mods/github-pr"
    if target.is_symlink():
        raise RuntimeError(f"Refusing to overwrite a symlink: {target}")
    if target.exists():
        try:
            ours = json.loads((target / "mod.json").read_text()).get("title") == "GitHub PR"
        except (OSError, ValueError):
            ours = False
        if not update or not ours:
            raise RuntimeError(f"{target} already exists; use --update only for an existing GitHub PR install")
    for program in ("go", "herdr-app"):
        if not shutil.which(program):
            raise RuntimeError(f"{program} is required (Go 1.23+ builds the helper)")
    # There are no third-party Go dependencies. Build before touching the install.
    with tempfile.TemporaryDirectory(prefix="github-pr-build-") as build:
        binary = Path(build) / "herdr-pr"
        subprocess.run(["go", "build", "-o", str(binary), "."], cwd=ROOT / "helper", check=True)
        shutil.copytree(ROOT / "mods/github-pr", target, dirs_exist_ok=update)
        (target / "bin").mkdir(exist_ok=True)
        shutil.copy2(binary, target / "bin/herdr-pr")
    subprocess.run(["herdr-app", "check", str(target)], check=True)
    print(f"Installed GitHub PR: {target}")
    print('Point your sidebar at github-pr with props {"mode":"branch"}. No layout or keys were changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", default=os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app"))
    parser.add_argument("--update", action="store_true", help="Update an existing GitHub PR installation")
    args = parser.parse_args()
    try:
        install(args.app_home, args.update)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"GitHub PR installation failed: {error}\n")


if __name__ == "__main__":
    main()
