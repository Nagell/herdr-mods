# Better Changes

A Git panel that looks like part of Herdr: a right sidebar with Changes and Commits tabs, a commit box, and diffs in one reusable centre tab.

![Better Changes](preview.png)

## What you see

The right sidebar starts at 368px, with radius 10 and a 1px `border`. Its 42px header holds two tab pills, 29px high with radius 7 and 12.8px text: the active one on `raised` with a `border` edge, the other plain in `muted`. **Changes** has a badge with the number of changed files, hidden at zero. **Commits** has a badge with the number of unpushed commits, shown at zero, and hidden only with no remote to compare with. Badges have 5px and 1px padding, radius 4, a `border` edge and 10px `muted` text. On the right are a refresh button and a ⋮ button, both 26px with radius 6.

The ⋮ menu is a 200px popover on `popover` with radius 7 and two labelled groups of 31px rows: Changes (Flat, Tree) and Diff (Inline, Side by side), with a check on the chosen one.

The Changes tab lists groups in the order Conflicts, Staged, Unstaged, Committed. Conflicts has an `ansi1` label, and its rows show the kind ("both edited", "deleted by you") in 11px `ansi1` instead of counts, with no stage button. A group heading is 30px with a chevron, a medium 11px `muted` label and a badge, and every heading but the first has a 1px line above it. Committed says "not on <ref>" in `dim`. Staged has **− Unstage all** on the right and Unstaged has **+ Stage all**, in 11px `dim` text. An empty group is hidden.

File rows are 28px with radius 7. Flat shows a file icon, the name, its folder from the repository root in 12px `dim`, then `+N` in `ansi2`, `−N` in `ansi1`, a status letter, and a 20px + or − button. Tree uses a 14px column and a 6px gap, indenting 20px per level, so every row at a depth starts in the same column: folders with a chevron and no icon, files with their icon. A 1px `border` guide runs under each open folder's chevron through everything inside it.

Below the list, past a 1px line, is the commit box with 10px padding: an 84px text field with radius 8 and a border that turns `accent` on focus, then a 32px split button. The main part is `solid` when Commit is ready, and `raised` otherwise, including Amend, and the 30px chevron part opens a popover with Commit and Amend. In Amend mode a line in `working` warns that it rewrites the latest commit.

The Commits tab shows groups with the same heading: the branch (unpushed), its remote branch, and on a feature branch `origin/HEAD`. The detail text beside a heading shows `origin/HEAD` when the branch tracks the default branch, the name it points to, and "N not pulled". Commit rows show the subject, author and age in 11px `dim`, and the short hash in the code font. Empty groups are hidden.

Opening a commit replaces the list: a 42px row with a back button, the short hash and, for a pushed commit on GitHub, an external-link button; then the subject, author and date, and the description; a 1px line; then a Changes heading with a badge and the commit's files in the chosen view.

A diff opens as a centre tab named after the file. Rows are in the code font at the terminals' size (`settings().font_size`) and 1.5 times as tall, with old and new line numbers. Side by side has Before and After columns that scroll together. Additions have an `ansi2` sign on an `ansi2` tint (alpha `26`), removals the same in `ansi1`, and hunk headings `accent` on `raised`. The code on every row is syntax-coloured, and text that isn't a token is `foreground`, so the sign and tint alone say a line was added or removed.

## How it behaves

Clicking a file publishes the pick to shared state, then opens or reuses one tab per space and renames it. Rapid clicks open one tab. The tab keeps its repository, because a mod pane has no terminal folder. A reopened tab restores its last file from localStorage.

The Stage button on a row stops propagation, so it doesn't open the file. Stage uses `git add` with literal pathspecs. Unstage uses `git reset -q HEAD`, or `git rm --cached` before the first commit. Bulk actions use `git add -A` and the same reset on `.`. While conflicts exist they name every other file instead, because staging a conflict marks it resolved, resetting one loses it, and `add -A` ignores exclude pathspecs. Working files are never changed.

Commit runs `git commit -m` and never `-a`. Amend reads `git log -1 --format=%H%x00%B`, fills an empty box without replacing a draft, rechecks HEAD before `git commit --amend -m`, and stops with a message if it moved. Enter makes a new line. Choosing a mode never commits. Conflicts disable both. A failure keeps the draft.

Unpushed files and commits come from `merge-base HEAD @{u}`, else `refs/remotes/<remote>/HEAD`. `origin/HEAD` comes from `symbolic-ref`. None of this fetches. Chosen tab, view, diff style and collapsed groups persist in localStorage. Git is polled every 10 seconds, the context checked every 300ms, and local repositories are watched. Reads disable optional locks, fsmonitor, external diff drivers and textconv. Agent status isn't shown: this is Git state.

Refresh spins its icon for at least one 900ms turn, and until the reads finish. Status polls don't spin it.

Mod commands, for shown copies: `better-changes.refresh`, `changes`, `commit`, `flat`, `tree`, `inline`, `split`, `open:<path>`.

A key bound to `mod.open:better-changes` opens the panel, showing hidden nodes above it and selecting it in its stacks. On an open panel it does nothing, unless the `panel.toggle` setting is `true` (default `false`): then it hides the slot the panel fills. A layout without the panel gets a notification.

A conflicted file's diff reads the working file and shows each marked block with three lines around it, under a heading "Conflict N of M · line L", with the file's own line numbers. Markers are on `raised`, yours tinted `accent`, incoming `ansi2`, base `dim`. Inline keeps file order; side by side pairs yours and incoming by position under columns labelled Yours and Incoming, and leaves out the base. A file with no markers says so. If `git ls-files -u` lacks stage 2 or 3, it says that side deleted the file. There's no resolution view.

Herdr's highlighter only reaches its editor, which can't draw a diff, so `syntax.js` is a small lexer with no grammar, the same file as Better Files'. The language comes from the file's extension, or its name for `Dockerfile`, `Makefile`, `Justfile`, `Gemfile` and `Rakefile`; `.env` and `.env.*` are env files (`#` comments, `KEY=` keys, values left as written). Each language has its own keywords, so `local` is one in Lua and shell but not in TypeScript; C, C++, Java, Kotlin, Swift, C#, PHP, Dart and Scala share one set. A type it doesn't know stays plain. It colours keywords (`ansi5`), strings (`ansi2`), comments (`dim`), numbers (`ansi1`), constants such as `true`, `null` and `ALL_CAPS` (`ansi6`), function calls, definitions and decorators (`ansi4`), PascalCase and built-in types (`ansi3`), tags (`ansi1`) and attributes (`ansi3`) in Vue, Svelte, Astro, HTML, XML and JSX/TSX, keys in JSON, YAML, TOML and CSS (`ansi1`), and Markdown headings and inline code. SQL keywords match in any case. Regex literals in JavaScript-like files are strings, a `{ … }` expression inside a tag is code, and in shell `#` starts a comment only at the start of a word. PHP, Dart and Groovy quote strings with `'` as well as `"`. Block comments, template strings, Go raw strings, Python docstrings and open tags carry from one line to the next. A diff is coloured once, top to bottom: the old and new sides each carry their own open comment or string, a context line sets both, and a hunk heading starts both afresh. A diff over 5,000 rows (`WHOLE_FILE_LINES`) is coloured a row at a time instead. Plain text, and a line over 2,000 characters, stay uncoloured.

## Built from

One mod, `mods/better-changes/`: `main.js`, `settings.js`, `file-icons.js` (an identical copy of Better Icons' resolver; with the table, file and folder rows and the diff's header draw its icons with `image()`, and the published pane head carries `color: true` so the pane header draws it untinted), `panel.js`, `syntax.js`, `mod.json`, `mod.schema.json` (its settings with their defaults, which the code's `DEFAULT_SETTINGS` must match), `git/` (`repository.js`, `reads.js`, `model.js`), `views/` (`sidebar.js`, `diff.js`, `pane-header.js`, `ui.js`) and `icons/` (Lucide, plus Herdr's pane header icons). `mod.json` is `{ "place": "right", "size": 368, "title": "Better Changes", "overlay": { "kind": "popup", "width": 1, "height": 1, "frame": "none" } }`. Props `{ "mode": "diff", "space", "source", "selection" }` make a diff tab. Another mod can hand it a diff to draw, as Branch PR does for a PR's file: a selection with scope `patch` carries `file: { path, add, del, patch }` and `commit.short` as its label, and is drawn from that patch without Git, or says GitHub left it out when `patch` is null; `props().overlay` means the panel key, which acts on the layout and closes itself, because `<mod>.<command>` can't reach a hidden copy; with none it's the sidebar.

It uses `div`, `svg`, flex containers, `Popover`, `TextareaState`/`Textarea`, `v_virtual_list` and `Scrollbar`. From Herdr: spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, layout, shared, setShared, run, nextCommand, notify, closeOverlay, localStorage. Commands: `tab.new` with mod and props, `tab.select`, `tab.rename`, `tab.close`, `layout.select`, `layout.show`, `layout.hide`. The only program it runs is Git; `cx.open_url` opens commit links. It reaches the network only through the person's own browser.

It publishes `shared("mod-icons")["better-changes"]` for a tab bar that draws mod icons. In the diff tab, a 30px row under the pane header shows the file. A layout can instead use this mod as its pane header (`pane.header.content.mod`, props `{ pane, terminal }`): it draws Herdr's header, reads no Git, and shows `shared("pane-heads")[pane]` = `{ title, detail, icon, add, del }`, which the diff publishes, so it then skips its own row.

## Watch out

Copying the folder isn't enough to show it. Shipped layouts are read-only and restored on start, so clone one and point its `changes` node's `content.mod` at `better-changes`. In your own layout, ask where it goes.

`herdr-app check` draws only the empty state: an unknown method on a list row or the commit box passes it, then shows as an error in the panel. Elements are single-use, so don't add one to a parent before it is finished being built elsewhere. Mods can't import from outside their folder, and a symlinked mod folder loads code but not icons.

Limit the list to 1,000 files, diffs to 1,500 lines and 4,000 characters per line, with a visible note. Handle binaries, empty files, deletions, conflicts, no first commit, pathspec characters and remote machines.

## Done when

- `node --test tests/*.test.cjs` passes, including real Git in temporary repositories, and `herdr-app check` passes.
- Flat and Tree show the same files. Every row at a depth starts in the same column, and guides join each folder to its contents.
- Stage, unstage and the bulk buttons move files between groups without changing them on disk.
- Commit takes only what's staged. Amend can change only the message, keeps a draft, and refuses when HEAD moved.
- Commits shows the unpushed group only when something is unpushed, and clears when it's pushed. A feature branch shows `origin/HEAD` separately.
- One tab per space, reused and renamed, restoring its file after a restart, in the chosen diff style.
- A diff's code is syntax-coloured, and a block comment or template string stays coloured on the lines after it.
- A key on `mod.open:better-changes` opens a closed panel and leaves an open one alone; with `panel.toggle` on, it closes an open one.
