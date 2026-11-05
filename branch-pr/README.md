# Branch PR

A pull-request panel for [Herdr Desktop](https://herdr.dev/), built to look like Herdr's own panels and to fit how you work with agents: see what's in the way of a PR, hand it to an agent, check the result, and merge. It works with GitHub through the `gh` CLI.

![Branch PR](preview.png)

- **Stats:** one line on every open PR gives Checks passed, Reviews approved and Unresolved threads, plus Ready, Conflicts or Behind when that's the news. A click goes to where each is explained.
- **Fix with agent** on a failed check, and **Send N to agent** for all unresolved threads, deliver in one click to the agent on the PR, or another you pick.
- **Agents on the PR** are listed with their state; click one to go to it.
- **Actions** in the PR's header holds Merge, Close and Reopen, which ask first. A merge names the commit you saw, so a newer push is refused. **Merge when ready** turns on GitHub's auto-merge while something is still in the way.
- **Comments:** threads, reviews and comments with their code, unread markers, author and unresolved filters, reply, resolve and reopen, and sending one comment to an agent with a prompt you can edit.
- **Checks:** workflows, jobs, steps and failed output, with links to GitHub.
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

`install.py --update` keeps your settings and drops `tools.gitlab`.

## Install only this mod

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/branch-pr

Requirements: Python 3 for the installer, **Go 1.23+** to build the helper, Git on the machines your spaces run on, and the **GitHub CLI** logged in with `gh auth login` on this computer. Agent actions use `hc` and a running agent.

Every read and write goes through `gh`, using its login; there's no token setting. If `gh` is missing or logged out, the panel says so, shows what to run, and offers Try again.

Read [RECIPE.md](RECIPE.md) and the source before installing. On an explicit click the panel can **post comments and replies, resolve and reopen threads, merge, close and reopen PRs, request reviews, fetch PR heads and create Git worktrees and branches, write the branch-to-PR link to Git config, open terminals, and send messages to agents.** Nothing writes on its own. Messages to agents tell them to treat GitHub's text as data and not to push or post unless asked.

From this folder:

```sh
python3 install.py          # first install
python3 install.py --update # later
```

The installer builds the helper, copies only `mods/branch-pr/` to `~/.config/herdr-app/mods/branch-pr/`, and runs `herdr-app check`. It doesn't edit layouts or keys.

### Place the sidebar

The manifest has `place: none`, so add it to a layout you own, about 368px wide:

```json
{ "mod": "branch-pr", "props": { "mode": "branch" } }
```

With Better Tabs, a button can open it (`target` is that block's layout ID):

```json
{
  "id": "prs",
  "label": "PR",
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

The installed `mods/branch-pr/mod.json` has a `settings` block, kept across `--update`:

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
python3 -m unittest discover -s tests
(cd helper && go test ./... && go vet ./...)
herdr-app check "$HOME/.config/herdr-app/mods/branch-pr"
```

`mods/branch-pr/main.js` lists what's where. `github/model.js` says what GitHub's answers mean, `github/` reads, `actions/` writes and hands off, `views/` draws with `views/ui.js`, and `icons/` holds the icons. `helper/main.go` is the JSON bridge to `gh`, with validated requests and a 26-second timeout. Tests use stand-ins for GitHub, so also look at the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
