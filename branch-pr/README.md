# Branch PR

A pull-request panel for [Herdr Desktop](https://herdr.dev/), built to look like Herdr's own panels and to fit how you work with agents: see what's in the way of a PR, hand it to an agent, check the result, and merge. It works with GitHub through the `gh` CLI.

![Branch PR](preview.png)

- **Stats:** one line on every open PR gives Checks passed, Reviews approved and Unresolved threads, plus Ready, Conflicts or Behind when that's the news. A click goes to where each is explained.
- **Fix with agent** on a failed check, and **Send N to agent** for all unresolved threads, open a dropdown: pick an agent already running, on the PR first; start a sub-agent under it, with **(spawn)**; or start a new one in its own tab. New ones work in the PR's worktree if it has one.
- **Agents on the PR** are listed with their state; click one to go to it.
- **Actions** in the PR's header holds Merge, Close and Reopen, which ask first. A merged PR shows a **Merged** badge there instead. A merge names the commit you saw, so a newer push is refused. **Merge when ready** turns on GitHub's auto-merge, offered only when GitHub has something required to wait for; a merge past anything else lists it first. GitHub merges whatever the branch holds once checks pass, so a push after you turn it on goes in too.
- **Comments:** threads, reviews and comments with their code, unread markers, author and unresolved filters, a box for a new comment after the last, reply, resolve and reopen, and sending one comment to an agent with a prompt you can edit.
- **Checks:** workflows, jobs, steps and failed output, with links to GitHub.
- **Files:** what the PR changes, with lines added and removed. A click shows the file's diff in [Better Changes](../better-changes/README.md)' centre tab when it's installed, read from GitHub so it works for a PR you haven't checked out; without it, the PR's files open on GitHub.
- **Reviewers:** who approved, who asked for changes, who is still to review, and asking someone again.
- **Worktrees:** a PR's checkouts, and **New worktree** to make another as its own space, with a terminal or an agent in its first tab.
- **Two lists in the sidebar:** **Branch** for the PRs from your checkout's branch, which goes straight to the details when there's only one, and **Repo** with search, including by number, All PRs / Created / Involved, and Open / Draft / Merged / Closed / All. Its count is GitHub's total for the filter. Opening a PR stays in the sidebar under the same tabs, with a back button, like a commit in Better Changes, and groups on it collapse.
- Local and remote spaces: Git runs on the space's machine, and `gh` on this computer.

## Upgrading from 1.x

2.0 is a rebuild around working with agents, and it removes some things:

- **GitLab** isn't supported any more. Stay on 1.x if you need it.
- **The All PRs center tab** is gone: the **Repo** tab in the sidebar replaces it. Close any old All PRs tab, and remove any `props: { "mode": "browser" }` tab or command you set up.
- **The commands** `open-browser`, `toggle`, `open`, `back`, `checks`, `conversation`, `description`, `worktree`, `preview` and `preview-browser` are gone. `refresh` stays.
- **Pending reviews, editing comments, quote replies, adding or removing reviewers, and Draft fix & reply** are gone. Agents do this work now; GitHub still has all of them.
- **Icons moved** to `icons/`, so change a Better Tabs button's `mods/branch-pr/pull-request.svg` to `mods/branch-pr/icons/pull-request.svg`.

Updating keeps your settings and drops `tools.gitlab`.

## Install only this mod

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/branch-pr

Requirements: **Go 1.23+** to run the installer and build the helper, Git on the machines your spaces run on, and the **GitHub CLI** logged in with `gh auth login` on this computer. Agent actions use `hc` and a running agent.

Every read and write goes through `gh`, using its login; there's no token setting. If `gh` is missing or logged out, the panel says so, shows what to run, and offers Try again.

Read [RECIPE.md](RECIPE.md) and the source before installing. On an explicit click the panel can **post comments and replies, resolve and reopen threads, merge, close and reopen PRs, request reviews, fetch PR heads and create Git worktrees and branches, write the branch-to-PR link to Git config, open terminals, and send messages to agents.** Nothing writes on its own. Messages to agents tell them to treat GitHub's text as data and not to push or post unless asked.

From this folder:

```sh
go -C helper run ./install          # first install
go -C helper run ./install --update # later
```

The installer builds the helper, copies only `mods/branch-pr/` to `~/.config/herdr-app/mods/branch-pr/`, and runs `herdr-app check`. It doesn't edit layouts or keys.

### Place the sidebar

The manifest has `place: none`, so add it to a layout you own, about 368px wide:

```json
{ "id": "pull-requests", "type": "block", "content": { "mod": "branch-pr" } }
```

With Better Tabs, a button can open it (`target` is that block's layout ID):

```json
{
  "id": "prs",
  "label": "PRs",
  "icon": "mods/branch-pr/icons/pull-request.svg",
  "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "pull-requests" }
}
```

## How it finds PRs

The sidebar follows the active terminal's folder and branch. It uses a branch's saved link to its PR if there is one (`branch.<name>.herdr-pr`, written by New worktree); otherwise it looks across your GitHub remotes for PRs from that branch, including forks, and prefers open ones. All of them are listed.

Repo prefers `upstream`, then the branch's tracking remote, then `origin`, and remembers a remote you pick. Search waits 450ms and starts at three characters, or at any length for a PR number, which finds that PR whatever the filters say; GitHub does the rest of the matching, including `author:` and `label:`. `+ N more` at the end of the list loads the next batch. **Involved** covers PRs you're involved in, asked to review, or have reviewed.

GitHub Enterprise and GitLab aren't supported.

## Commands

`branch-pr.refresh` reloads. Commands reach copies that are showing.

## Settings

[Better Config](../better-config/README.md) shows these with what each one does, and changes, checks and resets them for you. By hand:

Add a `settings` block to the installed `mods/branch-pr/mod.json` with only what you change. It is kept across `--update`. `mod.schema.json` beside it describes every setting, so an editor that reads `$schema`, such as VS Code or Zed, checks the block as you type. The defaults:

```json
"settings": {
  "refresh": { "every": "60s", "search_debounce": "450ms" },
  "list": { "page_size": 25, "default": { "tab": "all", "state": "open" } },
  "worktrees": { "root": "~/.herdr/worktrees", "open_with": "terminal" },
  "logs": { "keep_last": "60KB" },
  "tools": { "github": "gh" }
}
```

`refresh.every` is how often a visible panel re-reads. `list.default` picks the first filters until a saved view exists. `worktrees.root` is where New worktree puts checkouts; `open_with` is `terminal` or an installed agent's key. `logs.keep_last` caps failed output. `tools.github` is the path to `gh`. Unknown keys and wrong types are reported at the top of the panel and ignored.

## Development

```sh
node --test tests/*.test.cjs
(cd helper && go test ./... && go vet ./...)
herdr-app check "$HOME/.config/herdr-app/mods/branch-pr"
```

`mods/branch-pr/main.js` lists what's where. `github/model.js` says what GitHub's answers mean, `github/` reads, `actions/` writes and hands off, `views/` draws with `views/ui.js`, and `icons/` holds the icons. `helper/main.go` is the JSON bridge to `gh`, with validated requests and a 26-second timeout. Tests use stand-ins for GitHub, so also look at the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
