#!/bin/sh
# Copies the mod into Herdr, which reloads it. A symlink won't do: Herdr loads the code through one but not the icons.
cd "$(dirname "$0")" && rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json mods/better-icons/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/better-icons/"
