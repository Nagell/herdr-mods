# Better Files

A file browser for [Herdr Desktop](https://herdr.dev/) that opens files in the centre pane, beside your agents, instead of squeezing them into the sidebar. Built to look like Herdr's own panels and to fit how you work with agents: see where an agent has been, read what it wrote, and hand a file to one.

- **Tree:** the focused pane's folder, named in the panel's title, with changed files coloured and lettered by what happened (green new, yellow edited, red gone or in conflict), and folders holding changes in yellow with a dot. It refreshes as files change.
- **Click** a file to show it in one shared centre tab, so browsing doesn't pile up tabs.
- **Double-click**, or **Keep tab**, to keep that tab. The next click starts a new shared tab.
- **The file view** is read-only, at your terminal's font size, and follows the file as it changes on disk. Only a real change touches it. Binary and unreadable files say so, and very long files are cut at 400,000 characters.
- **Changed lines:** lines that differ from the last commit are tinted, with a solid bar at their edge: green added, yellow changed, and a thin red line across the file where lines were removed. A new file is all green. They update as the file changes, and clear when it's committed. The file is drawn as rows so the colours can't drift, so text can't be selected and there's no folding, and highlighting is simpler. Use **Open in** for those, or turn `gutter` off.
- **Images:** PNG, JPEG, GIF, WebP, BMP and SVG files show as pictures, fitted to the pane, and update when the file changes. Herdr only loads images from its own folder, so each is shown through a copy in `mods/better-files/cache/`, removed when its tab closes.
- **Open the whole folder** in your editor or Finder, from the folder icon beside refresh.
- **One title:** the tab's title row reads like a diff's, with the file, its folder, and Preview while it's the shared tab.
- **Open in** your code editor, from the tab or the menu. Zed, VS Code, Cursor, Windsurf, Sublime Text and Nova are offered when installed, and you can add more.

## Right-click

| Item | What it does |
| --- | --- |
| **Open**, **Open in new tab** | In the shared tab, or a tab of its own. Files only. |
| **Open in** an editor | Each installed editor. Folders too. |
| **Open in default app** | Whatever macOS opens that file with. |
| **Show in Finder** | Reveals it. |
| **Show diff** | Opens a changed file's diff in [Better Changes](../better-changes/README.md), if you have it. |
| **Copy relative path**, **Copy full path** | For pasting into a prompt. |
| **Send to** an agent | Asks what it should do, then sends that with the path. Choose an agent that's running, **(spawn)** to start a sub-agent under it, or a new one in its own tab. Only **Send** delivers. |

The path goes to the agent and not the file's text, so it reads the file as it is by then.

A space on another machine has no editor, default app or Finder items, because those apps are on this computer.

Editing, and creating, renaming or deleting files, aren't here on purpose: that's what your editor is for, and a file browser with a delete item is a way to lose work.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-files

[RECIPE.md](RECIPE.md) guides the install. Herdr's shipped layouts are read-only, so the mod only shows in a layout you own. Requirements: `sh`, and Git for the marks. Finding editors uses macOS Spotlight.

## Place the sidebar

The manifest has `place: none`, so add it to a layout you own, or point a block that uses Herdr's `files` at it:

```json
{ "id": "files", "type": "block", "content": { "mod": "better-files" } }
```

## Settings

The installed `mods/better-files/mod.json` has a `settings` block, and saving it applies at once:

```json
"settings": {
  "refresh": { "tree": "10s", "file": "2s" },
  "editors": [{ "name": "PhpStorm", "bundle": "com.jetbrains.PhpStorm" }],
  "gutter": true
}
```

`refresh.tree` is how often the tree rereads, on top of watching the folder, and never closer than 1 second. `refresh.file` is how often an open file is checked, never closer than 500ms. `editors` adds to the built-in list, by macOS app ID, and is only offered if installed. `gutter: false` uses Herdr's own editor instead: fuller highlighting, selection and folding, but no line colours.

## Limits

A folder lists its first 500 entries, and the tree shows 5,000 rows. A file view can't report a selection or jump to a line, because Herdr's editor component offers neither, so you send whole files and an editor opens at the top. Listing a folder needs `sh`, so a Windows machine shows an error.

## Development

```sh
node --test tests/*.test.cjs
./sync.sh
herdr-app check "$HOME/.config/herdr-app/mods/better-files"
```

`mods/better-files/main.js` lists what's where. Tests use stand-ins for Herdr, so also look at the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
