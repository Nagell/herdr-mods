# Herdr Mods

Independent mods for [Herdr Desktop](https://herdr.dev/).

A collection of standalone mods—not a bundled workflow or replacement layout. Choose a mod below and install only that package.

## Available mods

| Mod | What it does |
| --- | --- |
| [Better Changes](better-changes/README.md) | Git changes sidebar with tree/flat lists, stage/unstage controls, and a reusable inline or side-by-side diff tab. |
| [Better Spaces](better-spaces/README.md) | Spaces and nested worktrees with right-aligned Git branches and color-coded pull-request status from `gh`. |
| [Better Tabs](better-tabs/README.md) | Native tab bar with configurable action buttons, hooks, panel memory, and responsive overflow. |
| [Branch PR](branch-pr/README.md) | GitHub PR and GitLab MR sidebar and reusable browser tab with conversations, reviews, checks, worktrees, and explicit agent actions. |
| [Branch Issue](branch-issue/README.md) | Linear issue sidebar that follows the branch, an All issues browser, quick state/priority/assignee edits, comments, and Start work worktrees with agent handoff. |

### Better Changes

![Better Changes](better-changes/preview.png)

### Better Spaces

![Better Spaces](better-spaces/preview.png)

### Better Tabs

![Better Tabs](better-tabs/preview.png)

### Branch PR

![Branch PR](branch-pr/preview.png)

### Branch Issue

![Branch Issue](branch-issue/preview.png)

## Quick install

Copy this template into your Herdr agent, replacing `<mod-folder>` with the folder name of the mod you want:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/<mod-folder>
```

For example, to install Better Spaces:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-spaces

Each mod's README covers its features and requirements; its `RECIPE.md` guides installation. Installing one mod does not install the others.

## Test

Requires Node.js for development tests:

```sh
(cd better-changes && node --test tests/*.test.cjs)
(cd better-spaces && node --test tests/*.test.cjs)
(cd better-tabs && node --test tests/*.test.cjs)
(cd branch-pr && node --test tests/*.test.cjs && python3 -m unittest discover -s tests)
(cd branch-pr/helper && go test ./... && go vet ./...)
```

The mods use Herdr's native JavaScript runtime, without Node.js at runtime. Better Changes uses Git; Better Spaces uses Git, the GitHub CLI, and Herdr's `hc`. Better Tabs uses Herdr commands and has no external executable dependency. Branch PR uses Git, `gh` and/or `glab`, `hc`, and a bundled local Go helper (built during installation with Go 1.23+); see its README for access and explicit write actions.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution.
