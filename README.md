# Herdr Mods

Mods for [Herdr Desktop](https://herdr.dev/) built on Herdr's own mod API: a Git panel, a file browser, a sidebar, a tab bar, a settings dialog, and PR and Linear panels. Install one, or all of them as the [Estro](#estro-all-of-them-in-one-layout) layout.

![Better Sidebar, Better Tabs, Better Files, Better Changes and Better Config together in Herdr](docs/gifs/better-mods.gif)

Site: [munza.github.io/herdr-mods](https://munza.github.io/herdr-mods/)

## Why they're built this way

- **On Herdr, not around it.** Each mod is a separate mod loaded through Herdr's mod API: it reads its block's `props()`, is placed by a layout, and calls Herdr's commands. None patches Herdr's shipped mods, so a Herdr update doesn't overwrite them, and they leave Herdr's own UI alone.
- **They look like Herdr.** Each mod draws with the same design kit, `views/ui.js`: Herdr's sizes, radii, type and spacing measured from its shipped mods, as tokens and small components. A Better mod sits next to Herdr's own panels without looking added on.
- **One folder per mod.** Every mod folder holds `mods/<name>/` (the code, `mod.json`, and `mod.schema.json`), `tests/`, a `README.md` for people and a `RECIPE.md` for the agent that installs it. Nothing reaches into another mod's folder.
- **Settings described once.** `mod.schema.json` describes every setting: title, description, type, default and limits. The code keeps its defaults in one `DEFAULT_SETTINGS`, and a test checks that each mod's schema, its `mod.json` and its code's defaults agree. Your installed `mod.json` holds only what you changed.
- **Layout-driven.** A block's `props` choose what a mod draws, so one mod can fill several blocks. Better Sidebar draws the spaces list, the agents list, both under tabs, a footer or a panel toggle depending on `props.view`; Better Changes draws its sidebar, a diff tab or a pane header. You place the pieces where you want them in your own layout.
- **Plain tooling.** Tests are `node --test`, with no packages to install. The two mods that need native work (Branch PR, Branch Issue) have a small Go helper with its own tests, built on your machine at install. No Python, no global installs.

## Install

Copy this into your Herdr agent, with the mod's folder name:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/<mod-folder>
```

The agent follows the mod's `RECIPE.md`. Installing one mod doesn't install the others.

## The mods

Full docs for each (install, use, settings, update, developer use) are on the [site](https://munza.github.io/herdr-mods/docs/better-changes.html).

### The Better mods

Git, files, spaces, tabs, settings and icons.

- [Better Changes](better-changes/README.md) (`better-changes`): Git panel with staged, unstaged and unpushed files, stage and unstage, commit and amend, history, and an inline or side-by-side diff tab.
- [Better Files](better-files/README.md) (`better-files`): read-only file browser that opens files in the centre pane, with Markdown rendered, Git marks, Open in your editor, and a menu that hands a file to an agent.
- [Better Sidebar](better-sidebar/README.md) (`better-sidebar`): spaces with nested worktrees, Git branches and pull-request status, agents grouped by space or name prefix, both under Spaces and Agents tabs, and a one-line footer.
- [Better Tabs](better-tabs/README.md) (`better-tabs`): tabs you drag that wrap onto more lines, a toolbar for panels, and a ⋮ menu to hide and pin them.
- [Better Config](better-config/README.md) (`better-config`): every installed mod's settings in one dialog drawn like Herdr's Settings; it writes only what you changed and offers to restore your changes after an update resets them.
- [Better Icons](better-icons/README.md) (`better-icons`): VS Code's Material Icon Theme for the other mods. With it installed, Better Files and Better Changes show a colour icon for every file and folder; without it, mods keep their plain icons.

### Branch panels

Your PR and your Linear issue, next to the branch.

- [Branch PR](branch-pr/README.md) (`branch-pr`): GitHub PR panel that shows what stands between a PR and a merge, lists its files with diffs, hands failures and comments to agents, and merges when ready. Needs Go 1.23+ and `gh`.
- [Branch Issue](branch-issue/README.md) (`branch-issue`): Linear panel that follows the branch, edits state, priority and assignee, and opens a worktree with an agent holding the issue. Needs Go 1.23+ and a Linear API key.

## Estro: all of them in one layout

[Estro](estro/RECIPE.md) puts every mod in one window for directing agents: spaces and agents on the left, the session in the middle, and Files, Changes, PRs and Issues in a panel on the right. One prompt installs the layout and all seven mods:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/munza/herdr-mods/tree/main/estro
```

A mod you already have is updated, not installed twice, and an existing layout called `estro` is left alone. Tell the agent to skip any mod you don't want, and it leaves out that mod's button and block. *Estro* is Esperanto for the one in charge.

## Settings and updates

Every mod has a `version` in `mods/<name>/mod.json`. Change settings in Better Config, or edit the installed `~/.config/herdr-app/mods/<name>/mod.json`, which your editor checks against its schema; Herdr reloads the mod at once. Mods with a Go helper update with their installer's `--update`, which keeps your settings. The others update by copying their `mods/<name>/` folder again, after which Better Config offers to restore your settings. Each README lists its keys.

## Build your own on the same structure

Copy any mod folder as a starting point and keep its shape:

```text
my-mod/
  mods/my-mod/
    main.js            the View; reads props() to pick what to draw
    mod.json           { "$schema": "./mod.schema.json", "version", "place", "title" }
    mod.schema.json    Herdr's fields, and every setting with title, description, type, default
    settings.js        merges the installed settings over DEFAULT_SETTINGS
    views/ui.js        the design kit
  tests/my-mod.test.cjs
  README.md            what it does, for people
  RECIPE.md            how to install it, for an agent
  sync.sh              copies mods/my-mod/ into Herdr while you work
```

- Put Herdr's `herdr.d.ts` and `gpui-kit.d.ts` beside your code for editor types; they're gitignored and `sync.sh` skips them.
- Run `./sync.sh` after a change; Herdr reloads the mod.
- In this repo, `better-config/tests/config.test.cjs` picks up every folder with a `mods/<name>/mod.json` and checks its `mod.json`, `mod.schema.json` and `DEFAULT_SETTINGS` against each other, so a new mod is covered without registering it.
- Give the block a `props` value for each thing it can draw, and let layouts choose.

## Test

```sh
node --test */tests/*.test.cjs
for d in */helper; do (cd "$d" && go test ./... && go vet ./...); done
```

The mods run on Herdr's JavaScript runtime; Node.js is only for the tests. Each README lists what its mod calls at runtime (Git, `gh`, `hc`, Claude Code, macOS permissions).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution.
