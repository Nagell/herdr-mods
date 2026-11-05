# Better Files

A read-only file browser for a person's Herdr window, for directing agents rather than writing code by hand. Judge any addition by whether it helps someone see where an agent has been, read its work, or hand a file on. Editing and file operations stay out.

## What you see

One framed sidebar panel, radius 10, with a 42px header: the plain title Files with the folder's name in a badge, and refresh on the right.

Below is a tree for the focused pane's folder: 26px rows of chevron, icon, name and a Git letter, directories first, with a dot on a folder holding changes. A file or diff tab has no folder, so focusing one leaves the tree where it was.

A click opens the file in one shared centre tab per space, named after the file, or goes to its tab if it's already open. A double-click keeps that tab, and never opens a second. The next click starts a new shared tab.

The centre tab has one title row, the same as a Better Changes diff: file, folder and Preview while it's the shared one. It publishes that to `shared("pane-heads")`, which Better Changes' pane header shows, and draws its own 30px row only under another header. Keep tab and Open in float over the file's top right corner, or sit in that row. Below is Herdr's editor component, read-only, in the code font at the terminals' size.

Right-click opens a popup at the pointer with groups separated by rules: Open and Open in new tab (files); Open in each editor, Open in default app (files) and Show in Finder (this computer only); Show diff (a changed file, with Better Changes installed); Copy relative path and Copy full path; Send to each agent in the space, each also as `<name> (spawn)`, and to a new one of each installed kind.

Choosing an agent opens a box docked at the bottom of the panel with who it goes to, the path, and a prompt that's required. Only Send delivers.

## How it works

One class plays three roles, each its own copy: sidebar, viewer and menu, connected by `shared("better-files.*")`.

A copy can't name its own tab, so each viewer has an ID in a registry, `better-files.viewers`, holding its space, file, whether it's the shared one, and its tab. It records its tab from `focused()` as it opens, never one in the list of tabs that existed when it was asked for, or one another viewer holds. Entries for closed tabs are removed.

The menu closes at once, so it leaves its question in `better-files.compose` for the sidebar to ask.

The message to an agent is the prompt then the path, not the file's text. A running agent gets `hc send`; `(spawn)` runs `hc run --bg --parent <agent> --cwd <folder> <program> <message>` directly, so no shell sees the message; a new agent gets `tab.new` with the message as its first prompt.

Editors are found by macOS app ID with `mdfind`, because a Nix or per-user install isn't in `/Applications`, and opened with `open -b`.

Show diff hands over in the form Better Changes' own list uses: `better-changes.selection` and `better-changes.diff-tabs`, keyed to the Git root, with `tab.new` when no diff tab is open.

The gutter comes from `git diff -U0 HEAD`, with external diff and text conversion off, or all green for an untracked file. Herdr's editor can't mark a line or report its scroll, so it's made as tall as the whole file, with folding off, inside an outer box that scrolls it and the marks together. The line height is computed: GPUI's 1.618 ratio, rounded to whole device pixels at the zoom. `settings.gutter: false` restores the plain editor.

## Built from

`mods/better-files/`: `main.js`, `settings.js` (shared between this repo's mods), `mod.json` (`place: none`, title Better Files), `files/` (`model.js`, `reads.js`), `actions/` (`open.js`, `outside.js`, `agents.js`, `menus.js`), `views/` (`ui.js`, `tree.js`, `viewer.js`, `context-menu.js`), `icons/`. Adapted from Herdr's shipped Files mod.

## Watch out

Herdr's shipped layouts are read-only, so the sidebar only shows in a layout the person owns. Never overwrite an unrelated mod on a name clash. `herdr-app check` draws only the sidebar's first frame, so look at the running app too.

## Done when

- `herdr-app check` passes, and the tree lists the focused pane's folder with Git marks.
- A click reuses one centre tab, a double-click keeps it, and the next click opens another.
- An open file updates when it changes on disk, without losing your place when it hasn't.
- Right-click offers only what applies, and Send to an agent delivers the path.
