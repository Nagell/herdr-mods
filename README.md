# Herdr Mods

Independent mods for [Herdr Desktop](https://herdr.dev/), by [Tawsif Aqib](https://github.com/munza).

A collection of standalone mods—not a bundled workflow or replacement layout. Choose a mod below and install only that package.

## Available mods

| Mod / README                               | What it does                                                                                                      | Install                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [Better Changes](better-changes/README.md) | Git changes sidebar with tree/flat lists, stage/unstage controls, and a reusable inline or side-by-side diff tab. | [Install Better Changes](#install-better-changes) |

## Quick install

Give your Herdr agent the install prompt for the mod you want. Each package's README covers its features and requirements; its `RECIPE.md` guides installation. Installing one package does not install the others.

### Install Better Changes

Copy this prompt into your Herdr agent:

> Install only Better Changes from https://github.com/munza/herdr-mods/tree/main/better-changes. Read its README.md, RECIPE.md, and every source file first. Copy only its mods/better-changes folder into my Herdr app configuration, validate it, and integrate it into my existing layout. Preserve my other mods and key bindings, and do not overwrite an unrelated mod if the name is already taken.

Better Changes requires Git and a Herdr version supporting mod tabs. It runs Git in the selected repository and reads changed files. Staging, unstaging, and committing run only when requested through its controls. There is no GitHub API integration or helper binary in this package.

## Why this folder structure?

There are two layers: a **package for people and agents** and an **installed mod for Herdr**:

```text
better-changes/                 # Package: docs, installation recipe, preview, tests
  README.md
  RECIPE.md
  mods/
    better-changes/              # Install this folder only
      main.js
      mod.json
      ...                       # Supporting code and assets
```

Herdr discovers mods in its app configuration's `mods/` directory (normally `~/.config/herdr-app/mods/`). For this package, the installed entry point is `~/.config/herdr-app/mods/better-changes/main.js`. Its `mod.json` supplies the default docking placement: a 368px right sidebar on first discovery. Existing layouts control placement afterward.

So **the inner `mods/<name>/` structure matches Herdr's installed mod layout**, while the outer package folder is this repository's way of keeping each mod independently documented, tested, and installable. Herdr does not automatically install every package just because you clone this repository. Install only the chosen mod's runtime folder—not the whole repository, recipe, preview, or tests. No bundled layout replaces your setup.

## Test

Requires Node.js for development tests:

```sh
cd better-changes
node --test tests/*.test.cjs
```

The mod itself uses Herdr's native JavaScript runtime and Git, without Node.js at runtime.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution.
