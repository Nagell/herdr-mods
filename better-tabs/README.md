# Better Tabs

A tab bar for [Herdr Desktop](https://herdr.dev/): tabs you can drag, that wrap onto more lines when they don't fit, and a toolbar for your panels with a menu to tuck away the ones you rarely use.

![Better Tabs](preview.png)

- **Drag tabs** to reorder them. A separate line in the gap between tabs shows where the tab will land.
- **Tabs wrap** onto more lines, and the bar grows to hold them.
- The **+** sits right after the last tab.
- **Drag panel buttons** (Files, Changes and any you add) to reorder them, the same way.
- **The ⋮ menu:** drop a panel button on it to hide it. Click **⋮** to see hidden buttons, then click one to use it, drag it back out, or click its **pin** to return it to the toolbar. The menu also holds buttons there's no room for.
- Double-click to rename, right-click for the tab menu, and close the active tab with its ×.
- Program icons, working spinners and blocked or done dots.
- Each space remembers which panel it had open.
- Window controls where the system needs them.

A drag starts once a press has lasted 400ms and the pointer has moved 12px, so a quick click never drags.

## Install

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-tabs

Follow [RECIPE.md](RECIPE.md). Herdr's shipped layouts are read-only, so the mod only shows in a layout you own. Point your tabs block at `better-tabs`, keeping its size and `window_drag`.

The mod runs no programs and reaches no network. It runs Herdr commands and keeps its preferences in Herdr's shared state.

## Configure

Without configuration, the toolbar offers Files and Changes when those layout nodes exist. To choose the buttons, set `props` on the tabs block. Your list replaces the defaults.

```json
{
  "mod": "better-tabs",
  "props": {
    "rememberPanels": { "container": "panel", "stack": "panel-body" },
    "buttons": [
      {
        "id": "changes",
        "label": "Changes",
        "icon": "changes",
        "group": "panels",
        "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "changes" }
      },
      {
        "id": "palette",
        "label": "Commands",
        "group": "tools",
        "action": { "type": "command", "name": "app.palette" }
      }
    ]
  }
}
```

- `action` is required, either `panel` (show or hide a panel, by layout node ID) or `command` (run an app or mod command, with optional `args`).
- `id` is required and must be unique. `label` defaults to the ID.
- `icon` is a bundled name (`file`, `changes`) or an SVG path from the Herdr home, like `mods/my-panel/icon.svg`.
- `tooltip` and `group` are optional. A separator appears where the group changes.
- `when: { "node": "changes" }` shows a button only while that layout node exists and isn't hidden.
- `rememberPanels: false` turns panel memory off.

Your arrangement is saved per layout, by button ID, and doesn't edit the layout file.

`herdr-app do better-tabs.button:changes` runs a button by ID, and `herdr-app do better-tabs.overflow` opens the menu. Bind them in `keys.json` if you like; the mod installs no keys.

A mod's tab shows the icon it publishes in the `mod-icons` shared map. Better Changes does this.

## Settings

The installed `mods/better-tabs/mod.json` has a `settings` block:

```json
"settings": { "tabs": { "max_width": 170, "drag_delay": "400ms" }, "menu": { "width": 240 } }
```

`tabs.max_width` caps a tab's width in pixels. `tabs.drag_delay` is how long a press must last before a drag can start. `menu.width` sizes the ⋮ menu.

## Upgrading from 2.x

3.0 removes options nothing used: `hooks.js`, buttons from other mods (`contributions`), the `mod-tab`, `overlay`, `toggle-stack`, `sequence`, `shared` and `hook` actions, badges, the `enabledWhen`, `activeWhen` and `disabled` conditions, `iconOnly`, `order`, `overflow`, `maxButtons`, `toolbarId`, `commands`, `modIcons`, `tabMaxWidth`, `closeButtons`, `programIcons`, `statusIndicators`, `newButton`, `sidebar` and mouse-wheel tab switching. Tabs now wrap instead of scrolling.

## Development

In `mods/better-tabs/`:

- `main.js`: setup, settings and commands. `settings.js`: shared with the other mods.
- `actions/engine.js`: what a button does. `actions/toolbar.js`: arrangement and tab-move logic with no drawing.
- `views/tab-bar.js`: the bar. `views/menu.js`: buttons and the ⋮ menu. `views/drags.js`: dragging. `views/arrangement.js`: saved order. `views/panel-memory.js`: panels per space. `views/ui.js`: the design kit.
- `icons/`: this mod's icons.
- `sync.sh`: copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/better-tabs"
```

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
