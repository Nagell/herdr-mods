# Better Sidebar

A standalone sidebar for Herdr Desktop: spaces with right-aligned Git branches, nested worktrees and color-coded pull-request status from the GitHub CLI; agents with more ways to group them; and a one-line footer.

![Better Sidebar](preview.png)

Cmd-click a PR number to open it on GitHub.

- The current branch sits on the **same row as the space name, aligned right**, except `main`, `master` and a branch that repeats the name, which go without saying. The selected space also shows how far it is ahead of or behind its remote.
- Worktree spaces nest beneath an open space for the same repository. Each worktree keeps its own branch and PR status.
- A PR line below the space/worktree shows an icon and number, coloured **green Open**, **gray Draft**, **purple Merged**, **red Closed**, or **red Checks failed**. The tooltip says which. Colors follow the current theme.
- **Cmd-click the PR number** to open its GitHub URL (Ctrl-click on Linux/Windows). A normal click still selects the space. Hover a PR for its repository, title, and status. If there are several open PRs, the newest is shown with a `+N` summary; hover that summary for the others.
- Preserves space selection, right-click menus, drag reordering within a machine, colored avatars, ahead/behind counts, machine groups, and the compact sidebar rail.

## Agents

The agents block is adapted from Herdr's shipped panel and keeps its pins, sub-agents, status and fold behaviour. The icon beside **Agents** chooses how they are gathered:

- **Priority** and **Grouped by space**, as in Herdr.
- **Grouped by main space** puts a worktree's agents with its main checkout's, under the main space's name. A worktree whose main space is not open groups under the repository's folder name. It needs the spaces block of this mod in the same layout; without it each space is its own group.
- **Grouped by prefix** gathers names like `PR-12`, `INS-4` and `PLAT-work`, also after a folder as in `feature/INS-4`. It reads the worktree or space name first, then the tab name. Capitals need only the dash, lower case needs a number after it, so `pr-12` counts and `herdr-mods` does not. Everything else goes under **No prefix**, last.

## Footer

Settings and Add machine sit on one line as icons, with their names in tooltips. Settings shows a dot when an update is ready.

## Right panel toggle

The panel icon at the far right of the tab bar hides or shows the right panel without changing its selected view. It is its own block, so it needs the layout to hold the tab bar and this block in a row:

```json
{ "id": "tabs-row", "type": "row", "size": { "px": 42 }, "children": [
  { "id": "tabs", "type": "block", "window_drag": true, "content": { "mod": "better-tabs" } },
  { "id": "panel-toggle", "type": "block", "size": { "px": 36 }, "content": { "mod": "better-sidebar", "props": { "view": "panel-toggle" } } }
] }
```

`props.target` names another layout node to toggle; the default is `panel`. The included `keys.json` binds **Cmd+Shift+B** on macOS to `better-sidebar.toggle-panel`; merge it into `~/.config/herdr-app/keys.json`. The command only works while this block is in the layout.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-sidebar

Installation follows [RECIPE.md](RECIPE.md). Copy only `mods/better-sidebar/` into the app configuration. The manifest uses `"place": "none"`: the installer should **replace the existing spaces block's mod reference**, not add a second sidebar. Herdr's shipped layouts (`main`, `terminals`, `win98`) are read-only and restored on every start, so the mod only shows in a layout you own. If you are on a shipped layout, your agent clones it and edits the clone; if you already have your own layout, it asks whether to add the mod there or create a new layout. Preserve the agents list, other panels, key bindings, and the existing layout's dimensions. Never overwrite an unrelated mod on a name clash.

The spaces block should reference `"mod": "better-sidebar"`, the agents block `{ "mod": "better-sidebar", "props": { "view": "agents" } }`, and the footer block `{ "mod": "better-sidebar", "props": { "view": "footer" } }` with its height set to 37px. Each is optional. Keep its existing ID, size, and other properties. Leave the previous mod installed if other layouts still use it; restoring that reference rolls back the change.

## Requirements and access

- Git on every machine whose spaces you use.
- A local installation of [GitHub CLI](https://cli.github.com/), authenticated with `gh auth login`, with access to the repositories you want to show.
- Herdr's native mod APIs; no Node.js runtime dependency.

The mod runs read-only Git commands in space directories and calls `gh pr list` / `gh pr view`, which contact GitHub using your local credentials. **Remote Git reads run on the space's machine; GitHub queries run locally.** It never stages, commits, checks out branches, creates PRs, or changes Git configuration.

A space's branch and PR describe its **first terminal's live directory**, falling back to the space's folder—matching Herdr's space naming and worktree grouping. Switching to a different terminal tab does not change that rule.

## PR discovery and limits

GitHub.com HTTPS and SSH remotes are supported. GitLab, other hosts, and GitHub Enterprise hosts are not currently supported. Detached HEADs, non-Git folders, and branches with no matching PR have no PR line.

The mod checks the current branch against the checkout's GitHub remotes. It ignores same-named branches from unrelated forks, prefers open PRs, and otherwise shows the most recently updated closed/merged PR. Discovery examines at most 100 PRs per repository and branch.

An existing `branch.<branch>.herdr-pr` Git setting such as `owner/repo#42` overrides automatic discovery. The mod only reads that setting; it does not create it.

PR results refresh at most once a minute per checkout, with immediate lookups when Herdr reports a branch change. Successful identical GitHub queries are cached for one minute. Local Git changes also trigger refreshes through Git-directory watches; remote/external changes have a 15-second foreground fallback. An API or authentication failure preserves last-good PRs **only for the same branch**, marks them stale, and exposes the error on hover. Without a previous result, the line reads `PR unavailable`. New branch selections never inherit an old branch's PR.

The PR badge has no merge or review controls. Selecting its row selects the space; Cmd-clicking the number opens the PR in your default browser. Space menus continue to use Herdr's shipped `menu` mod. Worktree grouping is for **open spaces**, not every checkout on disk. A worktree without an open main-checkout space remains a top-level row.

## Settings

The installed `mods/better-sidebar/mod.json` has a `settings` block; copy your edits forward when you update the mod:

```json
"settings": { "git": { "retry_after": "15s" }, "pull_request_status": true }
```

`git.retry_after` is how long a failed Git read waits before it is tried again. `pull_request_status` set to `false` turns off the `gh` calls that colour pull-request state, for people without the GitHub CLI. Problems with the block are logged, not shown.

## Development

In `mods/better-sidebar/`:

- `main.js`: picks the part a block draws, from `view` in its props. `settings.js`: shared with the other mods.
- `git/checkouts.js`: reading a space's checkout. `git/pr-status.js`: GitHub discovery, PR appearance, caching, and stale-result handling.
- `views/spaces.js`, `views/agents.js`, `views/footer.js`, `views/panel-toggle.js`: the parts. `views/ui.js`: the design kit, Herdr's sizes and small components, with only what this mod uses.
- `icons/`: this mod's icons.
- `sync.sh`: copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.
- `tests/spaces.test.cjs` — isolated Herdr/GPUI stand-ins for discovery, polling, races, grouping, rendering, and packaging.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/better-sidebar"
```

See the repository's [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for upstream attribution.
