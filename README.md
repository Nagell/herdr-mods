# Herdr Mods

Independent mods for [Herdr Desktop](https://herdr.dev/).

A collection of standalone mods—not a bundled workflow or replacement layout. Choose a mod below and install only that package.

## Available mods

| Mod | What it does |
| --- | --- |
| [Better Changes](better-changes/README.md) | Git changes sidebar with tree/flat lists, stage/unstage controls, and a reusable inline or side-by-side diff tab. |
| [Better Spaces](better-spaces/README.md) | Spaces and nested worktrees with right-aligned Git branches and color-coded pull-request status from `gh`. |

### Better Changes

![Better Changes](better-changes/preview.png)

## Quick install

Give your Herdr agent the install prompt for the mod you want. Each package's README covers its features and requirements; its `RECIPE.md` guides installation. Installing one package does not install the others.

### Install Better Changes

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-changes

### Install Better Spaces

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-spaces

## Test

Requires Node.js for development tests:

```sh
(cd better-changes && node --test tests/*.test.cjs)
(cd better-spaces && node --test tests/*.test.cjs)
```

The mods use Herdr's native JavaScript runtime, without Node.js at runtime. Better Changes uses Git; Better Spaces uses Git, the GitHub CLI, and Herdr's `hc`.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution.
