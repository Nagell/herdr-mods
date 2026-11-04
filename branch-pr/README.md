# Branch PR

A standalone native pull-request sidebar and repository browser for [Herdr Desktop](https://herdr.dev/), for GitHub pull requests and GitLab merge requests.

![Branch PR](preview.png)

- **Branch sidebar:** PRs matching the current checkout, with Open, Draft, Merged, and Closed state icons.
- **All PRs:** one reusable normal browser tab per space. Close it with the tab bar's control or your existing tab-close shortcut.
- Search, **All PRs / Created / Involved** scopes, and Open/Draft/Merged/Closed/All filters.
- PR descriptions, conversations, reviews, threaded replies, unread markers, and checks: GitHub Actions workflows/jobs/failed logs, or GitLab pipeline jobs and their traces.
- Explicit comment/reply/resolve/reopen controls, agent handoff prompts, optional draft-fix proposals, and PR worktree creation.
- Local and remote spaces: Git/file operations run on the source machine; GitHub queries use local `gh` authentication and GitLab queries use local `glab` authentication, chosen by the remote's host.
- No dependency on Factory, Better Tabs, Workflow, or another custom mod.

## Install

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/branch-pr

Requirements: Herdr with native mod tabs, Python 3 for the installer, **Go 1.23+** to build the helper, Git on source machines, and a local **GitHub CLI** authenticated with `gh auth login` for GitHub repositories and/or a local **GitLab CLI** (`glab`) authenticated with `glab auth login` for GitLab ones, including self-hosted instances. Agent actions additionally use `hc` and a live agent in the source space.

**This mod depends entirely on the GitHub CLI.** Every read and write goes through `gh` on this computer, using its login. There is no token setting and no other transport. If `gh` is missing or logged out, the panel shows a plain message saying so (`GitHub CLI (gh) is not installed…` or `GitHub CLI is not logged in. Run gh auth login…`) with a Retry button; nothing else works until that is fixed.

Read [RECIPE.md](RECIPE.md) and the source before installation. The helper runs `gh` against GitHub using your existing credentials; the mod runs Git/`hc` and reads repository/proposal files. Explicit user actions can **post comments and replies, resolve/reopen review threads, fetch PR heads and create Git worktrees/branches, write PR-association config, open terminals, and send agent prompts**. Preview mode disables GitHub writes and worktree creation. Never test mutations against a user's repository without their instruction.

From this package directory:

```sh
python3 install.py
# Later, update an existing installation owned by this package:
python3 install.py --update
```

The installer builds the local helper without third-party Go dependencies, copies **only** `mods/branch-pr/` and the helper to `~/.config/herdr-app/mods/branch-pr/`, then runs `herdr-app check`. It does not edit layouts or keys. `HERDR_APP_HOME` or `--app-home` selects a different config home. It refuses an existing name unless `--update` is explicitly supplied for an existing Branch PR manifest; unrelated names and symlinks must not be overwritten. If renaming the mod, update its self-opening mod IDs, asset paths, helper path, and installer consistently.

The helper is installed at `mods/branch-pr/bin/herdr-pr`, not a Workflow-owned global path. Go is needed only to build/update it, not at runtime. Do not copy a compiled binary from a different OS/architecture.

### Place the sidebar

Herdr's shipped layouts (`main`, `terminals`, `win98`) are read-only and restored on every start, so the mod only shows in a layout you own. If you are on a shipped layout, your agent clones it and edits the clone; if you already have your own layout, it asks whether to add the mod there or create a new layout. Replace an existing PR/sidebar block's content, preserving its ID and dimensions:

```json
{ "mod": "branch-pr", "props": { "mode": "branch" } }
```

The manifest has `place: none`, so copying alone does not dock a second sidebar. If no PR slot exists, add one to a personal layout (about 368px wide is a useful start). The **All PRs** button opens/selects a browser tab directly; no toolbar integration is required.

### Open a browser tab

```sh
herdr-app do tab.new '{"name":"All PRs","mod":"branch-pr","props":{"mode":"browser"}}'
```

The default role is browser. The sidebar's **All PRs** action supplies `{mode:"browser",space,source:{cwd,on}}`, pinning the checkout and machine captured when opened. A manually created browser without source props follows the selected space. Repeated opens through the sidebar reuse the current space's existing Branch PR mod tab. A brief pending guard prevents rapid clicks from opening duplicates.

The browser has **one heading**, a right-aligned repository URL (Cmd-click/Ctrl-click opens GitHub), and a border beneath. There is no internal close button and no browser footer. Use normal tab controls. If a layout also frames lone panes with a header, set its tab block's `pane.lone` to false to avoid a duplicate title row; split-pane headers can remain.

### Optional Better Tabs integration

Better Tabs is optional. On start the mod publishes its pull-request icon under the shared `mod-icons` map so a Better Tabs bar shows it on the All PRs tab; without Better Tabs that entry is inert. A toolbar panel action points at the **layout node ID**, which need not be `branch-pr`:

```json
{
  "id": "prs",
  "label": "PR",
  "icon": "mods/branch-pr/pull-request.svg",
  "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "pull-requests" }
}
```

A Better Tabs command alias can open a browser even when the sidebar is hidden:

```json
{
  "commands": {
    "toggle-prs": { "type": "mod-tab", "mod": "branch-pr", "name": "All PRs", "props": { "mode": "browser" } }
  }
}
```

Bind `better-tabs.toggle-prs` in `keys.json` if desired, preserving existing shortcuts. This opens/selects a tab rather than closing it. The package installs no shortcuts.

## Repository and PR discovery

The branch sidebar follows the active terminal's cwd, falling back to its space folder. Selecting a pinned Branch PR tab retains its captured checkout rather than redirecting the sidebar to the space's original folder. Read the symbolic branch and any explicit `branch.<branch>.herdr-pr` association; otherwise inspect GitHub remotes, match exact head branches and source repositories (including forks), and prefer open matches. Choose among multiple PRs with the header selector. Detached HEAD and no-match cases have a usable empty state.

The browser's initial repository preference is `upstream`, then the branch tracking remote, then `origin`; valid saved remote choices are restored. Remotes on `github.com` are GitHub repositories named `owner/name`; remotes on any other host are treated as GitLab projects named `host/group/project`, so nested groups and self-hosted instances work as long as `glab` is logged in to that host. GitHub Enterprise is not supported. Git reads run on the source machine; the helper and authenticated GitHub calls run locally with explicit repositories. GitHub search indexing and minute-level refresh mean the display is not instantaneous.

## Browse, discuss, and check

Search debounces for 450ms and starts at three characters; GitHub matches titles/bodies and qualifiers such as `author:alice` or `label:bug`. Clear/shorten the query to restore unfiltered results. **Involved** combines assignment, requested reviews, submitted reviews, and comments; matches are deduplicated with reasons. **Load more** preserves independent cursors for involvement categories.

PR details provide Description, Conversations, and Checks. Conversation cards show authors, timestamps, resolved state, and bounded code context. The **Author** filter is a native dropdown with keyboard selection; author/unresolved filters preserve complete matching threads. **Reply / Quote reply** opens an editor with Markdown preview; no write occurs before explicit Reply/Comment. Drafts survive errors/navigation. A timeout may follow a successful server write: refresh before retrying.

**Pending reviews.** Every composer has a second button, **Start review** or **Add to review**, that holds the comment in your unsubmitted GitHub review instead of posting it. Thread replies join the review as pending review comments; a general comment becomes the review summary, and later ones append to it. Pending items show a **Pending** badge, the summary appears as a *Review · Pending (not submitted)* card, and a **Submit review (N)** button in the filter row publishes everything at once as a comment review. Until then only you can see them, on GitHub too.

**Editing.** Comments, replies and review summaries you wrote show an **Edit** control. It opens the same editor prefilled with the current text; **Save** updates the comment on GitHub. Editing is disabled in preview mode. Every comment card also has **Copy link**, which puts the comment's GitHub URL on the clipboard.

Checks show overall status and grouped workflows, jobs, steps, and failed logs (last 60KB), with links to full GitHub output. Open/draft/merged/closed use green/gray/purple/red icons; queued/running/passed/failed/skipped/cancelled check states have distinct icons. Agent working/blocked/done/idle are separate from PR state and do not recolor it.

Unread markers compare saved comment fingerprints. **Mark N read**, or leaving a visited Conversations view, updates the local snapshot. Browser filters, selected PR, sections, filters, expanded checks, and reply drafts are saved locally. The branch sidebar retains a status footer; the browser intentionally has none. Failed reads retain cached state where possible and offer Retry, never retrying writes automatically.

## GitLab differences

GitLab data is reshaped into the same views, with these mappings: merge requests appear as PRs with their `!iid` as the number; individual notes are comments; discussions with a diff position are code threads with resolve/reopen; approvals appear as approved reviews; your unpublished draft notes are the pending review, so **Start review / Add to review** create draft notes and **Submit review** publishes them in one go. GitLab has no "request changes" review event. Checks come from the merge request's latest pipeline, one check per job grouped under the pipeline, with no step level; **Failed step output** shows the job trace with terminal colours removed. Worktrees fetch `refs/merge-requests/<iid>/head` and live under `~/.herdr/worktrees/<host>-<group>-<project>/`.

## Worktrees and agent actions

**Reviewers** appear in PR details: who approved, who requested changes, who only commented and who is still to review, with the overall decision beside the heading. While the PR is open you can ask someone to review again, add a person or `org/team` with **Add**, and remove a request that is still waiting. GitHub keeps submitted reviews on record, so only waiting requests can be removed there; on GitLab any reviewer can be removed, and groups cannot be added.

**Merge, Close and Reopen** sit on the PR's detail row as a split button. An open PR offers the merge methods its repository allows, Merge first, plus Close in the dropdown; a draft offers only Close; a closed PR offers Reopen; a merged PR offers nothing. Every choice asks in a confirmation row before anything happens. **Squash and merge** also shows the commit message there, prefilled from the PR title and description, to edit before confirming: the first line is the subject and the rest the body. A merge names the head commit you saw, so a push made since then is refused rather than merged unseen. Source branches are left to the repository's own settings. Previews are read-only.

**Worktrees** appear in live browser details: every checkout whose branch is associated with the PR is listed with its worktree and branch name, and clicking a row switches to that worktree's space, or opens one when none is running. A PR may have any number of worktrees; **New worktree** proposes the PR's own head branch name and `PR-<number>` as the worktree, each with a numeric suffix when a checkout of this PR already uses it. Edit branch/worktree names independently; creation fetches the selected PR head (including forks), refuses existing branches and nonempty folders, creates a checkout under `~/.herdr/worktrees/<owner>-<repository>/<worktree-name>` on the source machine, associates its branch with the PR, and opens the checkout as a **new space**, which the spaces sidebar nests under the repository at once. An **Open with** dropdown on the form chooses what runs in that space's first tab: a terminal, or any installed agent from Herdr's program table; that tab takes focus. If opening the space fails, the checkout is retained and the Open button retries only that step. Public previews cannot create worktrees.

**Send to agent** offers agents in the source space and an editable prompt containing the PR/comment context. Only Send delivers through `hc`. **Draft fix & reply** asks that agent for read-only analysis and a proposed fix/reply; results are stored under `.workflow/pr-proposals/` for compatibility with existing drafts. This is just a local data path: the Workflow mod/recorder is **not required** and is never invoked. Proposals bind repository, PR, commit, and comment context; stale results cannot post. Review/edit the draft before the explicit GitHub write.

## Commands and previews

Commands reach shown mod copies, per Herdr's command-delivery rules:

- `branch-pr.open-browser` (alias `toggle`): open/select the reusable browser tab.
- `branch-pr.refresh`, `branch-pr.back`, `branch-pr.open:123` (browser), `branch-pr.checks`, `branch-pr.conversation`, `branch-pr.description`, `branch-pr.worktree`.

Read-only public previews:

```sh
herdr-app do 'branch-pr.preview:cli/cli#14854,14858'
herdr-app do 'branch-pr.preview-browser:cli/cli'
# Restore live sources:
herdr-app do 'branch-pr.preview:off'
herdr-app do 'branch-pr.preview-browser:off'
```

Preview settings are shared and persist until disabled. They do not change remotes. There is no merge, checkout-discard, or automatic GitHub write action.

## Settings

The installed `mods/branch-pr/mod.json` has a `settings` block, kept across `python3 install.py --update`:

```json
"settings": {
  "refresh": { "every": "60s", "search_debounce": "450ms" },
  "list": { "page_size": 25, "default": { "tab": "all", "state": "open" } },
  "worktrees": { "root": "~/.herdr/worktrees", "open_with": "terminal" },
  "logs": { "keep_last": "60KB" },
  "tools": { "github": "gh", "gitlab": "glab" }
}
```

`refresh.every` is how often a visible browser re-reads; `search_debounce` the pause after typing. `list.default` picks the first tab and state filter until a saved view exists. `worktrees.root` is where New worktree creates checkouts, `~` meaning the source machine's home; `open_with` is `terminal` or an installed agent's key. `logs.keep_last` caps failed-step output. `tools` are the paths of the two CLIs. Durations take `ms`, `s`, `m` or `h`; sizes `B`, `KB` or `MB`. Unknown keys and wrong types are reported at the top of the panel and ignored. Layout block `props` override these for one copy.

## Development

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests
(cd helper && go test ./... && go vet ./...)
herdr-app check "$HOME/.config/herdr-app/mods/branch-pr"
```

`main.js` owns native UI, repository state, commands, and async invalidation. `typography.js` resolves font settings. `helper/main.go` is the JSON bridge to `gh` with validated requests and a 26-second timeout. `install.py` builds/copies only this package. Tests use mocked API calls, not live GitHub writes; initial native checks do not exercise every deferred/async state, so inspect the running app too.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
