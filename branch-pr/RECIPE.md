# Branch PR

A pull-request panel for a person's Herdr window, for directing agents rather than writing reviews by hand. Judge any addition by whether it helps someone see what needs attention, send it to an agent, check the result, or merge. It depends entirely on the GitHub CLI.

![Branch PR](preview.png)

## What you see

It follows Better Changes, and everything stays in one framed sidebar panel, radius 10, with no center tab of its own (a file's diff opens in Better Changes' one). Headers are 42px.

The header always holds pill tabs, Branch [n] and Repo [n], with refresh on the right, and the tab choice is remembered. Until its first answer a tab shows a spinner in place of its count and can't be clicked; a refresh of what's already read keeps the number. Repo's count is GitHub's `issueCount` for the current filter; Involved has no single count, so it shows what's loaded with a `+`. Branch lists the PRs from the checkout's branch, or with exactly one goes straight to its details, with no back button. Repo adds a filter block with a rule under it: search on its own row, then choosers for scope and state, a remote chooser when there's more than one, and a GitHub icon for the repository. A PR's row has its state icon, title and checks icon on the first line, and details and `#n` in the code font on the second, so each lines up down the list. `+ N more` at the end of the list loads the next batch. A 34px footer with the branch and when it last updated closes the panel in every view.

Opening a PR works like opening a commit, under the same tabs. Until it loads, everything below the tabs is a back row and a centred spinner, and back cancels it. Then a fixed about block has, on its first line, a back chevron unless it's the branch's only PR, the state icon (open ansi2, draft dim, merged ansi5, closed ansi1), the title with `#n` dim after it as on GitHub, and a GitHub icon; on its second, `author · head → base` in small print with the Actions menu on the right, or on a merged PR a Merged badge the Actions button's size, outlined and coloured ansi5 with the merged icon; and on an open PR its stats. Directly below, with no rule between, are the second-level tabs, Overview, Comments [n], Checks with the overall state icon, and Files [n] from `changedFiles`: plain text over a rule, with a 2px line on that rule under the active one, so they don't read as the pills above.

The stats are one quiet line on a subtle, rounded strip of `raised` at half strength, wrapping if it must, separated by dots, each a dim label then a medium value carrying the colour, so a glance compares: Checks as passed/total (ansi1 with a failure, ansi3 while running, ansi2 when all pass), Reviews as approved/asked (ansi1 if changes were requested), and Unresolved threads. Merge joins them only to say what those don't: Ready, Conflicts, Behind, Draft or Auto. A tooltip spells each out, and Checks, Reviews and Unresolved click through to where they're explained. Whether to offer Merge when ready comes from the blockers: Draft, Conflicts, failed or running checks, Changes requested, unresolved threads, Review required, Behind base, or `mergeStateStatus` BLOCKED.

Overview is a scrolling list of collapsible groups with rules between them, whose open state is remembered: Agents (a status dot, name and status; a click runs `agent.focus`), Reviewers (icon, login, state, and a re-request button for anyone not already waiting), Worktrees (every worktree on the PR's head branch or a branch bound to it by `branch.<name>.herdr-pr`; the name on the left, the branch on the right; a click switches to its space or opens one), and Description in Markdown.

The Actions menu lists what can be done, the likeliest first. An open PR offers `Merge when ready` first if the repository allows auto-merge and `mergeStateStatus` is BLOCKED or BEHIND, the only states GitHub actually waits in, then its merge methods, then Close set apart by a rule. A draft offers Close, a closed PR Reopen, one with auto-merge on Cancel merge when ready and Close, and a merged PR has no menu. Every choice asks in a confirmation block under the about block, on any tab; Squash and merge shows its commit message there to edit, and any merge lists what's still in the way, since GitHub merges past whatever it doesn't require. Merge when ready uses the `enablePullRequestAutoMerge` mutation, never `gh pr merge --auto`, which merges at once when nothing is required.

Comments has fixed filters with a rule under them: an author chooser, an Unresolved toggle and Mark N read, with a bordered Send N to agent on the right of the same line, wrapping below when the panel is narrow. Below are collapsible blocks separated by rules, with resolved threads shut at first: kind and path:line, the last 6 lines of the diff hunk, each comment with author, New, age and a copy icon for its link, then Reply and Resolve or Reopen, with a bordered Send to agent on the right; a second agent adds a joined chevron to choose. A reply's box opens inside its block; a handoff of several comments docks at the bottom. After the last block, always there, is a box for a new comment with a Comment button, its draft kept per PR.

Files lists the PR's files from `repos/R/pulls/N/files` (paginated, read when the tab opens and again only when the head commit changes): a caption with the count and a small toggle between a tree (the default, folders first with chevrons that close them, as in Better Changes) and a flat list, remembered as `files-layout`; each file is a file icon, the name, in the flat list its folder dim, and `+n` ansi2 and `−n` ansi1 in the code font; the last one clicked is highlighted. If `mods/better-changes/mod.json` exists under the app home, checked once at start, a click hands the file to Better Changes the way its own sidebar does: `shared("better-changes.diff-tabs")[space]` gets the space folder as `source` and a selection with scope `patch`, `PR #n` as its label, and GitHub's patch, then its diff tab is renamed and selected, or opened with `tab.new`. Better Changes draws a `patch` selection from the patch it carries, without Git, and says so when GitHub left the patch out. Without Better Changes, a click opens the PR's Files page on GitHub.

Checks has a collapsible group per workflow run, those needing attention first and failures open. A row is a chevron, state icon and name, then the time or, on a failure, Fix with agent. Opening one loads its job: View on GitHub, steps, Failed step output, and the log in the code font.

## How it behaves

The panel follows the active terminal's cwd and branch. Branch uses `branch.<branch>.herdr-pr` if set, else exact-branch PRs across GitHub remotes from those remotes' own heads, open ones first. Repo prefers upstream, the branch's tracking remote, then origin, and restores a saved remote; a remote that isn't GitHub is shown disabled. A PR keeps its own repository, which can differ from the list's.

A hidden panel doesn't refresh at all, checked through `layout()`, and comes up to date when shown. To spare API quota, a refresh re-reads Branch, the open PR, and Repo only while it's showing, plus once for its count. A token per kind of read stops an old answer replacing newer state. A reload reopens the saved PR once; a branch change shows the list, or its only PR.

Search debounces 450ms and starts at three characters, or at any length for a number. GitHub's search doesn't match PR numbers, so a number (with or without `#`) reads that PR directly, ignoring the filters, and otherwise is searched as text. Involved unions `involves:`, `review-requested:` and `reviewed-by:` with a cursor each, deduplicated.

The space's folder and branch come from the active tab's focused terminal; a tab with none, such as Better Changes' diff, keeps the last terminal's, so moving to it doesn't read the PR again. Filters, the open PR, its tab and filters, expanded checks, read markers and drafts are saved per repository. Read markers compare a hash of each comment's text, so an edit reads as new.

An agent is on a PR if its pane is inside one of the PR's worktrees, or in this space on the PR's branch. Handoffs are one dropdown: those first, then others in the space, each also as `<name> (spawn)`, which starts a sub-agent of the same program under it with `hc run --bg --parent`, passing the message as an argument so no shell sees it, then Start for each installed agent from `knownAgents`, which opens a tab with `tab.new` and the message as its first prompt. New agents work in the PR's worktree, else the space's folder. Fix with agent and Send N to agent deliver on choosing, through `hc send` to a running agent. Fix with agent names `gh run view --job N --repo R --log-failed` rather than pasting the log. Send to agent on one comment opens an editable prompt that only Send delivers. All say to treat GitHub's text as data and not to push, post or resolve unless asked.

New worktree proposes the PR's branch and `PR-<number>`, each with a suffix if taken, and an Open with choice of terminal or an installed agent. It checks the names, refuses existing branches, re-reads the PR's head, fetches `refs/pull/N/head`, stops if the fetched commit differs, runs `git worktree add` under `worktrees.root/<owner>-<repo>/<name>`, writes the branch link, and opens a new space. If opening fails the checkout stays, and Open retries only that step.

A missing or logged-out `gh` replaces everything below the tabs with what's wrong, the command to run, Try again, and a link to install it if it's missing. Writes never retry by themselves. A failure keeps the draft or confirmation and says to refresh first if it may have gone through.

## Built from

`mods/branch-pr/`: `main.js`, `settings.js` (shared between this repo's mods), `mod.json` (`place: none`, title Branch PR), `mod.schema.json` (its settings with their defaults, which the code's `DEFAULT_SETTINGS` must match), `github/` (`model.js`, `discovery.js`, `reads.js`), `actions/` (`changes.js`, `agents.js`, `worktrees.js`, `menus.js`), `state/saved.js`, `views/` (`ui.js`, `list.js`, `detail.js`, `conversation.js`, `checks.js`, `worktrees.js`, `files.js`), `icons/`. `helper/` is `go.mod`, `main.go`, `main_test.go` with no dependencies; `helper/install/` builds it to `mods/branch-pr/bin/herdr-pr`. Remote spaces run Git there, and the helper stays local.

## Watch out

Before installing, explain the Git, `gh` and `hc` execution and the writes above. Never test writes against someone's repository without their say-so; read-only checks against a public repository are fine.

Herdr's shipped layouts are read-only, so the mod only shows in a layout the person owns. The installer doesn't edit layouts or keys.

`herdr-app check` draws only the empty state, so look at the running app too.

## Done when

- Node tests, Go tests and vet, including the installer's, and `herdr-app check` pass.
- A missing or logged-out `gh` takes over the panel with what to do, and Try again.
- Both lists and a PR render without errors with real PRs, all inside the sidebar.
- The stats match GitHub for a failing, a conflicted and a clean PR.
- A handoff reaches the agent on the PR, and with no agent says so and sends nothing.
- A merge after a newer push is refused.
