# Better Changes

A Git panel for Herdr Desktop, built to look like Herdr's own panels: file changes, staging, commits and history in a sidebar, with diffs in the centre.

![Better Changes](preview.png)

- **Changes** lists **Conflicts**, **Staged**, **Unstaged** and **Committed** (not pushed yet) files in collapsible groups. Groups with nothing in them are hidden.
- **+** and **−** stage or unstage a file; **Stage all** and **Unstage all** act on the whole repository except conflicts. Working files are never touched.
- The **⋮** menu picks **Flat** or **Tree** for file lists, and **Inline** or **Side by side** for diffs.
- **Full file**, shown when you hover over the diff's header row, shows the whole file with its changes marked, instead of only the changed lines. It applies to every diff until you turn it off. A diff still stops at `limits.diff_lines`.
- Clicking a file opens its diff in one reusable centre tab, named after the file. It comes back to that file after a restart.
- **Commits** lists history, grouped by your branch and its remote, and opens any commit's description and changes, with a link to GitHub for commits already pushed.
- A commit box with **Commit** and **Amend**.
- Local and remote spaces: Git and file reads run on the space's machine.
- **Icons:** with [Better Icons](../better-icons/README.md) installed, changed files and their folders get colour icons from VS Code's Material Icon Theme, in the lists and the diff's header. Without it, files keep the plain icon and folders have none.

## Install only this mod

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-changes

[RECIPE.md](RECIPE.md) guides the install. Herdr's shipped layouts are read-only, so the mod only shows in a layout you own. On a shipped layout, your agent clones it and points its Changes slot at `better-changes`.

Requires Git on each machine you use.

## Commit and amend

**Enter** makes a new line; only the button commits. The chevron beside it switches between **Commit** and **Amend** without running either.

- **Commit** creates a commit from what is staged, and needs a message and at least one staged file.
- **Amend** rewrites the latest commit with what is staged and your message, and can change just the message. Choosing it loads the latest message into an empty box, but never replaces text you wrote. If something else moved the latest commit since, it stops and asks you to choose Amend again.

Both are off while conflicts remain, and a failure keeps your message. This mod never pushes. Be careful amending a commit you have already shared.

## Conflicts

Conflicted files get their own **Conflicts** group at the top, each saying what kind it is, such as "both edited". One opens with Git's traditional `<<<<<<<`, `=======` and `>>>>>>>` markers, showing only the conflict blocks with a few lines around them and the real line numbers from the file. **Inline** shows the block as it is in the file, including the base section if your Git writes one. **Side by side** puts yours on the left and incoming on the right. It says when one side deleted the file. Showing them is all this does: resolving is left to an agent or your editor. Commit stays off until no conflicts remain.

## Commits

Your branch comes first, with the commits not pushed yet, then its remote branch. The badge on the **Commits** tab counts the unpushed ones.

On a feature branch, a third group shows the remote's default branch, `origin/HEAD`, from where your branch left it. When your branch tracks the default branch, the two share one group, labelled with both. A group says **N not pulled** when the remote has commits you lack. All of this reads the last fetch and never fetches.

A branch that was never pushed compares with `origin/HEAD`. With no remote to compare with, there is one group and no badge on the tab.

## One header row

A mod can't change Herdr's pane header, which names a diff tab `better-changes`, so a diff tab has two rows: that header, then the file. To get one row, use this mod's own header, Herdr's with the file added, in a layout you own:

```json
"pane": { "header": { "content": { "mod": "better-changes" } } }
```

Terminals look the same as with Herdr's header. It's a copy of Herdr's `pane` mod, so it won't pick up later changes to it.

## Settings

[Better Config](../better-config/README.md) shows these with what each one does, and changes, checks and resets them for you. By hand:

Add a `settings` block to the installed `mods/better-changes/mod.json` with only what you change. Saving it applies at once. `mod.schema.json` beside it describes every setting, so an editor that reads `$schema`, such as VS Code or Zed, checks the block as you type. The defaults:

```json
"settings": {
  "refresh": { "status": "10s" },
  "limits": { "files": 1000, "diff_lines": 1500, "line_length": 4000, "commits_per_page": 50 },
  "default": { "view": "tree", "diff": "inline" },
  "panel": { "toggle": false }
}
```

`refresh.status` is how often Git is read. `limits` bound the file list, the lines and line length shown in a diff, and the commits loaded per page; zero falls back to the default. `default.view` (`tree` or `flat`) and `default.diff` (`inline` or `split`) apply until you choose in the **⋮** menu. `panel.toggle` makes the key below close an open panel. Unknown keys and wrong types are reported in the log and ignored.

## A key for the panel

Bind any key to `mod.open:better-changes` in `keys.json`:

```json
"global": { "cmd-alt-g": "mod.open:better-changes" }
```

It opens the panel, and selects it if it shares a stack such as Herdr's Files and Changes. On an open panel it does nothing, unless `panel.toggle` is `true`: then it closes it. A layout without the panel shows a notification.

## Limits

Stage all and Unstage all apply past the file limit. Side by side pairs adjacent removed and added lines by position, not by similarity. A rename shows as a deletion and an addition. Commit links are for GitHub remotes named `origin`. A branch pushed without an upstream still compares with `origin/HEAD`.

Colors show additions and removals, not whether a person or an agent wrote the lines.

## Development

In `mods/better-changes/`:

- `main.js`: setup, settings and commands. `settings.js`: shared with the other mods. `panel.js`: what the panel key does, with no Herdr calls.
- `git/repository.js`: following the repository, the index, history, commit and amend. `git/reads.js`: plain functions that read from Git. `git/model.js`: parsing with no Herdr calls.
- `views/sidebar.js`, `views/diff.js`, `views/pane-header.js`: the three things it can draw. `views/ui.js`: the design kit, Herdr's sizes and small components. Every look lives here.
- `icons/`: Lucide icons, the set Herdr uses, and Herdr's own pane header icons.

- `sync.sh`: copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/better-changes"
```

`herdr-app check` only draws the empty state, so a mistake in a list or the commit box shows up only in the running panel.
