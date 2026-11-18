#!/bin/sh
# Copies the mod into Herdr, which reloads it.
cd "$(dirname "$0")" && rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json mods/better-alerts/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/better-alerts/"
