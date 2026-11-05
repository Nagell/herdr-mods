#!/bin/sh
# Refreshes this layout's copies of the mods from their own folders in this repo.
cd "$(dirname "$0")" || exit 1
for mod in better-changes better-sidebar better-tabs branch-issue branch-pr factory hands; do
  mkdir -p "mods/$mod"
  rsync -a --delete --exclude bin --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json --exclude .DS_Store "../$mod/mods/$mod/" "mods/$mod/"
done
