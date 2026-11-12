# Better Files

A read-only file browser for a person's Herdr window, for directing agents rather than writing code by hand. Judge any addition by whether it helps someone see where an agent has been, read its work, or hand a file on. Editing and file operations stay out.

## What you see

One framed sidebar panel, radius 10, with a 42px header: the plain title Files with the folder's name in a badge, and on the right a folder icon, a menu opening the folder in each editor or Finder (this computer only), and refresh.

Below is a tree for the focused pane's folder: 26px rows of chevron, icon, name and a Git letter, directories first, with a dot on a folder holding changes. The icon is the plain file or folder in `muted`, or, when Better Icons is installed, its full-colour Material icon at 14px, open folders with their open icon. A file or diff tab has no folder, so focusing one leaves the tree where it was.

A click opens the file in one shared centre tab per space, named after the file, or goes to its tab if it's already open. A double-click keeps that tab, and never opens a second. The next click starts a new shared tab.

Image files show fitted to the pane instead of the editor, through a copy in `mods/better-files/cache/`, because `image()` only loads from under Herdr's folder; a space on another machine says it can't show them. The centre tab has one title row, the same as a Better Changes diff: file, folder and Preview while it's the shared one. It publishes that to `shared("pane-heads")`, which Better Changes' pane header shows, and draws its own 30px row only under another header. A Markdown file opens rendered, with Preview and Code beside Keep tab to switch to the file view; the choice is kept per tab, and `settings.markdown` sets the first one. Keep tab and Open in float over the file's top right corner, or sit in that row. Below is the file, read-only, in the code font at the terminals' size.

Right-click opens a popup at the pointer with groups separated by rules: Open and Open in new tab (files); Open in each editor, Open in default app (files) and Show in Finder (this computer only); Show diff (a changed file, with Better Changes installed); Copy relative path and Copy full path; Send to each agent in the space, each also as `<name> (spawn)`, and to a new one of each installed kind.

Choosing an agent opens a box docked at the bottom of the panel with who it goes to, the path, and a prompt that's required. Only Send delivers.

## How it works

One class plays three roles, each its own copy: sidebar, viewer and menu, connected by `shared("better-files.*")`.

A copy can't name its own tab, so each viewer has an ID in a registry, `better-files.viewers`, holding its space, file, whether it's the shared one, and its tab. It records its tab from `focused()` as it opens, never one in the list of tabs that existed when it was asked for, or one another viewer holds. Entries for closed tabs are removed.

The menu closes at once, so it leaves its question in `better-files.compose` for the sidebar to ask.

The message to an agent is the prompt then the path, not the file's text. A running agent gets `hc send`; `(spawn)` runs `hc run --bg --parent <agent> --cwd <folder> <program> <message>` directly, so no shell sees the message; a new agent gets `tab.new` with the message as its first prompt.

Editors are found by macOS app ID with `mdfind`, because a Nix or per-user install isn't in `/Applications`, and opened with `open -b`.

Show diff hands over in the form Better Changes' own list uses: `better-changes.selection` and `better-changes.diff-tabs`, keyed to the Git root, with `tab.new` when no diff tab is open.

Changed lines come from `git diff -U0 HEAD`, with external diff and text conversion off, or all green for an untracked file. Herdr's editor can't mark a line or report its scroll, and marks laid over it slid as it scrolled, so the file is drawn as rows in a `v_virtual_list`, like a Better Changes diff: a 3px bar, the line number, then the code in simple one-line colouring, tinted by its mark, with a thin row holding a 2px red line where lines were removed. Clicking a change that replaced something, through the list's `on_item_click`, shows the old lines in red above it, and its new lines turn green. `settings.gutter: false` uses Herdr's editor instead.

The Markdown preview is gpui-base's `TextView.markdown`, as Herdr's own PR mod uses it, wrapped as `Markdown` in `views/ui.js`, selectable and not scrolling on its own. `markdownBlocks` in `files/model.js` splits the file only where an unindented line is just a local image, outside code fences, so each such picture is copied into the cache and drawn with `image()` like an image file; everything else goes to TextView whole. Links come back through `on_link_click`: `http(s)` goes to `cx.open_url`, a path is resolved from the file's folder and opened as a tree click would, and anchors and other schemes do nothing. The choice is `markdown: "preview" | "code"` on the viewer's registry entry. A tab's copies, its image and its Markdown pictures, are removed when it closes.

Each view calls `followFileIcons(this, cx)` from `files/file-icons.js`, a copy of Better Icons' own, kept identical, which keeps `this.fileIcons` current and redraws on an install or update. `fileIcon` picks a row's picture by its full path, and `image()` draws it, since `svg()` would tint it one colour. With no table, `FileIcon` in `views/ui.js` draws the mod's own tinted icon. The tab's title row uses the same icon, and so does the head published to `shared("pane-heads")`: with `color: true` when it's full colour, so Better Changes' header draws it untinted.

## Built from

`mods/better-files/`: `main.js`, `settings.js` (shared between this repo's mods), `files/file-icons.js` (shared the same way), `mod.json` (`place: none`, title Better Files), `mod.schema.json` (its settings with their defaults, which the code's `DEFAULT_SETTINGS` must match), `files/` (`model.js`, `reads.js`), `actions/` (`open.js`, `outside.js`, `agents.js`, `menus.js`), `views/` (`ui.js`, `tree.js`, `viewer.js`, `context-menu.js`), `icons/`. Adapted from Herdr's shipped Files mod.

## Watch out

Herdr's shipped layouts are read-only, so the sidebar only shows in a layout the person owns. Never overwrite an unrelated mod on a name clash. `herdr-app check` draws only the sidebar's first frame, so look at the running app too.

## Done when

- `herdr-app check` passes, and the tree lists the focused pane's folder with Git marks.
- A click reuses one centre tab, a double-click keeps it, and the next click opens another.
- An open file updates when it changes on disk, without losing your place when it hasn't.
- A Markdown file opens rendered, Preview and Code switch it per tab, and its links and pictures work.
- Right-click offers only what applies, and Send to an agent delivers the path.
