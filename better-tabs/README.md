# Better Tabs

A standalone native tab bar and extensible action toolbar for [Herdr Desktop](https://herdr.dev/).

![Better Tabs](preview.png)

- Select, drag-reorder, double-click rename, right-click, and close tabs. A pointer-following drag preview and insertion marker show exactly where a tab will land.
- The new-tab **+** sits immediately after the last tab.
- Program icons, native working spinners, and blocked/done indicators.
- Configurable buttons for panels, app/mod commands, overlays, stack toggles, shared state, or custom local JavaScript hooks.
- Button groups, ordering, tooltips, icon-only display, shared-state badges, visibility/enabled predicates, and active highlighting.
- An always-visible vertical **⋮** menu for toolbar actions. Drag actions onto it to hide them, then drag them back out or use the **Show in toolbar** pin icon. Hidden actions are listed alphabetically.
- A sidebar-toggle icon immediately after **⋮** hides or reopens the right sidebar without changing its selected panel.
- Responsive overflow, with a configurable maximum number of visible toolbar buttons and a saved arrangement per layout.
- Optional panel memory per space; window controls where the OS requires them.
- No dependency on a workflow, Better Spaces, Better Changes, or any other custom mod.

## Install

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-tabs

Follow [RECIPE.md](RECIPE.md). Copy only `mods/better-tabs/` to the app's mods folder. It uses `place: none`: replace your existing tabs block's mod reference, preserving the block's dimensions and window-drag setting. Clone shipped layouts first. Do not add a second tab bar or overwrite an unrelated mod on a name clash.

The mod itself does not run executables, read repository files, or contact a network. It runs Herdr commands, opens overlays, and reads/writes mod preferences and shared state. Configured commands, overlays, and trusted hooks can perform broader operations; review them before installing.

## Configure in your layout

The tabs block's `content.props` controls the toolbar. Without custom buttons it offers Files and Changes when those layout nodes exist. Custom `buttons` **replace**, rather than append to, the defaults.

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
        "action": {
          "type": "panel",
          "container": "panel",
          "stack": "panel-body",
          "target": "changes"
        }
      },
      {
        "id": "palette",
        "label": "Commands",
        "group": "tools",
        "action": { "type": "command", "name": "app.palette" }
      }
    ],
    "commands": {
      "toggle-browser": {
        "type": "toggle-stack",
        "stack": "center-body",
        "child": "browser",
        "fallback": "main"
      }
    }
  }
}
```

To open a regular center tab, use an action such as `{ "type": "mod-tab", "mod": "my-panel", "name": "My Panel", "props": { "mode": "browser" } }`. It reuses an existing pane of that mod in the current space, guards rapid repeated opens, and lets the normal tab controls close it. The target receives `props.space` and `props.source: { cwd, on }` captured from the active terminal (falling back to the space folder); these reserved props override action-supplied values. The target mod must use those props to pin its own repository context. This is intentionally one tab per mod per space, not one per props combination.

Panel targets are **layout node IDs**, not mod names. A `changes` node can contain stock Changes or Better Changes. Panel actions select the target and show its container, or hide it when already selected. `rememberPanels: false` disables panel memory. Only one container/stack pair is remembered per toolbar copy.

### Actions

| Type | Fields | Behavior |
| --- | --- | --- |
| `command` | `name`, optional `args` | Dispatch a built-in or shown mod's command. |
| `panel` | `container`, `stack`, `target` | Toggle a panel and infer its active state. |
| `mod-tab` | `mod`, optional `name`, `props` | Open/select one reusable mod tab per mod per space, with captured checkout context. |
| `toggle-stack` | `stack`, `child`, `fallback` | Toggle between two children; infer active state. |
| `overlay` | `mod`, optional `kind`, `props`, `width`, `height` | Open a popup (default), dialog, or window. |
| `sequence` | `actions` | Dispatch a bounded list of actions in order; **does not wait for asynchronous completion**. |
| `shared` | `key`, `value`, or `toggle: true` | Set or toggle a shared state value. |
| `hook` | `name`, optional `args` | Call a trusted handler exported by this mod's `hooks.js`. |

`herdr-app do better-tabs.button:changes` invokes a visible configured button by ID, respecting visibility/enabled conditions. `herdr-app do better-tabs.toggle-browser` invokes the example command alias above. `herdr-app do better-tabs.overflow` opens the hidden/overflow action menu. Bind those same command strings in `keys.json`; the package installs no bindings itself.

Herdr delivers mod commands only to **shown copies**. Do not use a command hook to depend on a hidden or unmounted mod. A sequence dispatches in order but is not a transaction and does not roll back earlier commands on error.

### Button presentation

- Required: unique `id`, `action`. `label` defaults to the ID.
- `icon`: bundled name (`file`, `changes`, `close`, `spinner`), or SVG path relative to the Herdr app home, e.g. `mods/my-panel/icon.svg`.
- `tooltip`, `iconOnly`, `group` (a separator when the group changes), numeric `order` (ascending, stable ties).
- `overflow: true` starts an entry in the overflow menu; a saved user arrangement can restore it to the toolbar.
- `disabled: true` or `enabledWhen` prevents action dispatch.
- `when` controls visibility. `activeWhen` overrides inferred active state.
- A condition is `{ "shared": "my-mod.ready" }`, `{ "shared": "my-mod.mode", "equals": "review" }`, `{ "node": "panel" }` (exists and not hidden), or `{ "node": "stack", "child": "review" }`.
- `badge`: a literal value or `{ "shared": "my-mod.count" }`. Missing/null/false/empty-string badges are omitted; zero is shown.

### Tab and toolbar preferences

### Dragging tabs and arranging the toolbar

Drag a tab along the bar to reorder it. Its original slot dims, a preview follows the pointer, and a colored insertion line indicates before/after placement. Reordering happens only when you release; small pointer movements remain ordinary clicks. Leaving the bar cancels the drag. The **+** scrolls with the tabs and remains directly after the last tab.

The right-hand Files/Changes/custom controls are **toolbar actions**, separate from the terminal/mod tabs:

- Drag an action onto **⋮** and release to hide it in the menu.
- Click **⋮** to see hidden and automatically overflowed actions in alphabetical order. Clicking an entry performs its normal action.
- Drag a menu entry out toward the toolbar; the menu closes so you can drop it before or after a visible action. A preview and insertion marker show its destination.
- Alternatively, click an entry's **Show in toolbar** pin icon to restore it at the front without activating it.
- Drag visible toolbar actions before/after one another to change their order.

The arrangement is saved in Herdr shared preferences by layout and `toolbarId` (default `"main"`). Give multiple independent toolbars in one layout distinct `toolbarId` values. Menu copies share the originating toolbar's preferences. Stable action IDs preserve choices when configuration changes; this does not edit your layout file.

`maxButtons` limits visible buttons; the responsive width budget may show fewer. Remaining buttons go to overflow. Restoring a menu entry puts it within the visible order, displacing another action into overflow if the limit is reached. Very narrow bars or `maxButtons: 0` can still leave every action in the menu. The compact menu uses Herdr's popover colors and standard menu-sized rows, anchors below the dots button, and shows only a short “No hidden actions” line when empty. Dragging/pinning instructions live in tooltips rather than a header. The menu snapshots its entries when opened, while badge values and active/enabled predicates remain live.

`tabMaxWidth` defaults to 170 logical px. `closeButtons` accepts `"active"` (default), `"all"`, or `"none"`. Set `programIcons`, `statusIndicators`, `newButton`, or `scrollNavigation` to false to disable them. `sidebar` overrides the sidebar node ID used for macOS traffic-light spacing. Keep layout titlebar and traffic-light settings intact.

### Sidebar visibility

The panel icon immediately after **⋮** toggles the right sidebar without changing its selected panel. Its tooltip changes between **Hide sidebar** and **Show sidebar**. It stays outside the hideable action list.

By default it targets `rememberPanels.container`, or the `panel` layout node. Set `"panelToggle": "my-sidebar"` to target a different node, or `"panelToggle": false` to omit it. The control is omitted if the target does not exist.

### Other mods contributing buttons

Opt in with `"contributions": true`. A cooperating mod can publish declarative entries through Herdr shared state:

```js
const registry = shared("better-tabs.buttons") ?? {};
setShared("better-tabs.buttons", {
  ...registry,
  "my-panel": [{
    id: "my-panel.refresh",
    label: "Refresh panel",
    action: { type: "command", name: "my-panel.refresh" }
  }]
});
```

Publish on initialization or explicit state changes, **never during render**. Namespace IDs, merge without dropping other publishers, and remove your registry key when unregistering. Shared state persists across restarts; this is not automatic plugin discovery or a liveness registry. Contributions are opt-in, trusted, and can invoke any supported action. Layout-owned entries win ID clashes; owners are sorted for deterministic ordering. Shared state cannot carry callback functions.

### Custom JavaScript hook

Edit this package's `hooks.js` (a local trusted extension point):

```js
import { run } from "herdr";
export const hooks = {
  newNamedTab(args, { space }) {
    if (space) run("tab.new", { space: space.id, name: args.name });
  }
};
```

Configure `{ "type": "hook", "name": "newNamedTab", "args": { "name": "Review" } }`. Handlers receive `(args, { space, tab, cx })`; use `cx.spawn(async cx => ...)` for async work, never retain callback contexts, and never import another mod's source. Reinstalling upstream files can overwrite local hook edits; retain them separately. Exceptions and returned promise rejections become notifications.

## Development

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/better-tabs"
```

`main.js` renders the tabs/toolbar, handles pointer gestures, and synchronizes panel memory outside render. `toolbar.js` contains pure action-arrangement and tab insertion-boundary helpers. `actions.js` resolves conditions, contributions, and declarative actions. `hooks.js` is the optional local extension point. Assets are bundled, with shipped Herdr `menu` and `new-menu` used for native menus.

Tests cover action dispatch, missing targets, recursion limits, hooks, contributions, command aliases, per-space memory, tab actions, drag thresholds/previews, insertion boundaries, drop-to-hide, drag/pin restoration, alphabetical overflow, preference isolation, and standalone packaging. Native checks do not replace testing deferred menu rendering in the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
