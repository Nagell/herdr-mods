# Better Changes

A focused Git changes sidebar and diff viewer for Herdr Desktop.

![Better Changes](preview.png)

- Full-height changed-file list, with connected icon pills for **Tree / Flat** and **Inline / Side by side**. Hover for tooltips.
- Separate **Staged** and **Unstaged** groups. Use **+** to stage and **−** to unstage a file, or the group-header controls for all files.
- Partially staged files appear in both groups; each entry opens its own version of the diff.
- One reusable diff tab per space. File selections rename the tab to the filename. Close it with the tab close button or your existing `tab.close` binding (normally **Cmd+W** on macOS).
- Aligned Before/After columns in side-by-side mode, with shared vertical scrolling. Trackpad horizontal scrolling, Shift+wheel, or the header arrows scroll both columns horizontally.
- Herdr's configured fonts, green additions, red removals, and old/new line numbers.
- **Commit staged** commits only staged changes. Unstaging preserves working files, including in repositories without a first commit.
- Local and remote spaces: Git and file reads run on the space's machine.

## Install only this mod

Ask your agent to install this folder, following [RECIPE.md](RECIPE.md). It reads the source, copies `mods/better-changes/` into your Herdr app configuration, validates it, and fits its sidebar into your existing layout. No bundled layout replaces your setup.

Requires a Herdr version supporting mod tabs (`tab.new { mod, props }`) and Git on each machine you use. The default manifest docks the sidebar on the right at 368px when Herdr first discovers it. If your layout already provides a Changes slot, your agent can put `better-changes` there with `{ "mode": "sidebar" }` instead of creating another panel.

A name clash must be resolved before copying: retain the existing mod, rename this package's folder, and update its mod names and asset prefixes consistently. Do not overwrite an unrelated installation.

## Limits

The list displays at most 1,000 changed files. Bulk stage/unstage applies to the whole repository. Diff previews display at most 1,500 lines and 4,000 characters per line. Binary, unreadable, and empty files show explicit messages. Split view pairs adjacent removed/added lines by position; it does not calculate word-level matching. File trees do not detect renames; a rename appears as deletion/addition.

Colors indicate additions/removals, not whether an AI or human edited the lines. Git and Herdr do not supply reliable uncommitted edit-author attribution.

The sidebar reads repository status on a timer and uses local folder watches. Remote repositories refresh through polling. Explicit `source: { cwd, on }` props can pin the mod to a repository; normally it follows the active terminal.

## Development

### Code map

- `mods/better-changes/main.js` — the native Herdr view, organized into lifecycle/synchronization, repository status, file selection, diff loading, Git mutations, and rendering sections. The sidebar and diff tab are separate instances of the same view; namespaced shared state connects them.
- `mods/better-changes/model.js` — pure transformations for Git status/numstat parsing, file trees, line numbering, and side-by-side row pairing.
- `mods/better-changes/typography.js` — sizing and font helpers that follow Herdr's live settings.
- `tests/changes.test.cjs` — a lightweight Herdr/GPUI stand-in plus behavior tests, including real Git operations in temporary repositories.
- `tests/packaging.test.cjs` — standalone packaging and asset checks.

Start with `model.js` for the data shapes, then follow `init()` → `refresh()` → `render()` in `main.js`. Clicking a file calls `pick()` in the sidebar; the diff tab observes that selection through `syncSelection()` and loads its preview with `loadDiff()`. Comments explain repository pinning, async request invalidation, and index-only Git mutations.

### Checks

```sh
node --test tests/*.test.cjs
herdr-app check "$HOME/.config/herdr-app/mods/better-changes"
```

Tests cover file parsing, trees, partial staging, index-only commits, real Git index operations, stale responses, tab reuse, repository pinning, and split-line alignment. Run Git-operation tests in temporary repositories; do not stage or commit a user's working repository for testing.

See the repository's [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
