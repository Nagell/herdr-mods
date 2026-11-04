# Branch Issue

A standalone native Linear issue sidebar and issue browser for a person's existing Herdr window, built as a sibling of GitHub PR. It talks to Linear's GraphQL API through a bundled helper that reads the personal API key only from the LINEAR_API_KEY environment variable (its own, then a login shell's); a missing or rejected key must surface as a plain panel message naming LINEAR_API_KEY with Retry, never a key field or a generic failure. The sidebar shows the issue bound to the active checkout; All issues opens a reusable normal center tab. Preserve the person's terminal tabs, layout, and shortcuts. No Workflow, Better Tabs, or GitHub PR dependency.

## What you see

Use a full-height theme-background panel with a 1px theme border, 10px rounding, and a 42px header. The branch sidebar header reads Issue, with an issue picker when the branch resolves to several issues, All issues, and refresh. It displays details directly for the branch's issue. The browser heading is Linear. A border separates the header from content. There is no browser footer or internal close button.

The browser's filter row holds a flexible search field and pickers for scope (My issues / Active cycle / All issues), state (Active / Backlog / Started / Done / Cancelled / All states) and, with more than one team, team. The list groups rows by workflow state under a small header with the state's colour dot and count. Rows show the state dot, identifier, title, priority label and assignee initial. Load more follows the list.

Details show Back (browser only), a state dot, identifier and title on one centre line, an Unlink icon for hand-bound sidebar issues, and an external-link icon for Linear. A meta row holds three pickers that write on choice (state with coloured dots, priority, assignee with Me and Unassigned first), label pills with their colours that remove the label on click, a Label picker of the team's remaining non-group labels that adds one, project · cycle · estimate, and Start work at the right edge (browser only). Below it the worktree list card and the inline worktree form. Tabs: Description, Comments with count, Links with count, Sub-issues when present. Comment cards group a root comment with its replies indented by a left rule; own comments get Edit; each card has Reply and Send to agent; the comments tab header has Add comment and Hand to agent. Branch view keeps a 34px footer with the branch, update time and identifier.

Linear states carry hex colours; draw them with a dot, never a mapped theme colour. Use theme colours and configured fonts, resolving em-like sizes through ui_font_size, then font_size, then 14.

## How it behaves

Branch discovery follows the active terminal cwd and machine. Read the symbolic branch, then union identifiers from `git config branch.<branch>.herdr-issue` (comma separated) with `TEAM-123` patterns in the branch name (uppercased, at most four candidates), confirm them with the helper's `resolve` action which drops unknown identifiers, prefer the binding's order, and remember the picked identifier per space. No match shows a Link issue field that confirms the identifier with Linear and appends it to the binding. An issue present only through the binding gets an Unlink icon in the detail header that removes it from the binding (unsetting the key when it empties); identifiers found in the branch name never get one.

All issues opens one browser mod tab per space using tab.new; subsequent clicks select it with tab.select. Save source {cwd,on} and space in props; guard rapid repeated opens. On init write mod-icons["branch-issue"] = the package's issue.svg path, nothing else shared. Load viewer and teams once per panel; use the viewer id for Edit on own comments and the Me assignee choice.

Debounce search 450ms; queries shorter than three characters clear server filtering. The helper builds an IssueFilter: assignee isMe for My issues, cycle isActive for Active cycle, state type sets for the state filter, team key for the team filter, and an `or` of title/description containsIgnoreCase plus a team-key/number match when the query looks like an identifier. Order by updatedAt with one cursor. Refresh roughly once per minute when visible and on explicit refresh.

Quick edits run the helper's `update` action with stateId, priority 0–4, assignee id, unassign, or the full labelIds list, and merge the returned state/assignee/priority/labels into the open issue, the branch list and the browser list. Comments use commentCreate with an optional parentId, edits use commentUpdate, both only on explicit buttons; drafts persist per issue and composer. Agent prompts carry the issue as data with an explicit do-not-post line and deliver only through hc send.

Live browser details list the issue's worktrees (branches whose `herdr-issue` binding includes the identifier, joined to `git worktree list --porcelain`); a click runs space.select for a space already on that folder, else space.new {folder, machine, tab}. Start work prefills Linear's branchName (or a slug of identifier and title) with a numeric suffix past existing worktrees, a worktree name that follows the branch until edited, and a base branch read from refs/remotes/origin/HEAD. Creation validates the ref and name, refuses existing branches, fetches the base from origin, runs `git worktree add -b <branch> <path> FETCH_HEAD` under ~/.herdr/worktrees/<repo folder>/<name>, writes the binding and `linear.issue-status`, optionally moves the issue to the team's started state, and runs space.new with argv [...agent.run, issuePrompt] for an agent or no argv for a terminal. A space-open failure retains the checkout for retry. Never discard working files.

Commands: open-browser/toggle, refresh, back, open:<identifier>, description/comments/links, worktree. They reach shown copies only.

## Built from

One package with mods/branch-issue/main.js, typography.js (identical to GitHub PR's), mod.json (place:none, title:Branch Issue), SVGs, helper/go.mod/main.go/main_test.go, install.py, tests, and docs. The dependency-free Go 1.23+ helper posts to https://api.linear.app/graphql with the key in the Authorization header, reads the key from LINEAR_API_KEY, falling back to `$SHELL -lic 'printf %s "$LINEAR_API_KEY"'`, and never stores it. Actions: viewer, list, detail (identifier or UUID), resolve, comment, edit-comment, update. Comment pagination is followed to the end.

Native GPUI div/svg and gpui-base flex, input/textarea, Markdown, and Popover controls. One keyboard-navigable dropdown helper serves every picker. Herdr supplies spaces, panes, agents, props, shared/setShared, exec, hc, home/appHome, theme, nextCommand, run, knownAgents, timers, native URL opening, and localStorage.

## Watch out

The key is a personal token with the person's full Linear access: say so before install and never log it. The login-shell fallback runs the person's shell startup files once per request. Linear's branchName follows the team's branch format, which may contain slashes; the worktree name is its slug. The assignee picker only lists active team members. Attachment rows open their URL; there is no cross-mod call into GitHub PR.

Herdr's shipped layouts (`main`, `terminals`, `win98`) are read-only and restored on every start, so the mod only shows in a layout the person owns. Check `shared("layout")`: if the shown layout is shipped, clone it with `herdr-app do layout.clone '{"name":"<shown>","as":"<name>"}'` and edit the clone; if the person already has their own layout, ask whether to add the mod to it or to create a new layout. Say which layout now holds it. Add a block `{ "mod": "branch-issue", "props": { "mode": "branch" } }` to the panel stack or replace one slot, preserving node IDs, dimensions, sibling panels, and keys. No Node/DOM/CSS, retained callback contexts, top-level await, timers for animation, or render-time shared-state writes.

## Done when

- Node tests, Python installer tests, Go tests/vet, and herdr-app check pass.
- Package has no Factory/Better Tabs/Workflow/GitHub PR dependency.
- A missing or rejected LINEAR_API_KEY shows the plain message with Retry and no key field.
- The sidebar resolves a branch from its binding or its name, offers Link issue otherwise, and picks among several.
- The browser filters, searches, groups by state, pages, and opens details; quick edits write once per choice.
- Comments, replies, and edits post only on explicit buttons; failed posts keep the draft.
- Start work creates the worktree from the fetched base, binds the branch, opens a nested space with the chosen terminal or agent carrying the issue prompt, and retains the checkout on space-open failure.
