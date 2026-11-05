# Better Tabs

A tab bar for a person's existing Herdr layout: draggable tabs that wrap onto more lines, a + after the last tab, and a toolbar of panel buttons with a ⋮ menu to hide them in.

## What you see

A theme-chrome bar 42px high, growing as tabs wrap, with a 1px bottom `border`. Tabs and toolbar start 6.5px from the top. Tabs are 29px pills with radius 7, 10px padding, a 7px gap inside and 6px between, in 12.8px text. The active tab is `raised` with a `border` edge and a ×; others are plain in `muted`. A tab shows its program's icon at 14px, its name up to 170px, a 12px spinning `working` icon, or a 6px `blocked` or `done` dot.

After the last tab, wrapping with the tabs, is a 26px + button. On the right, staying on the first line, are the toolbar buttons, 26px high with radius 6, 12px text and an optional 14px icon, `selected` when active, with a 1px separator where the group changes. Last is a 26px ⋮ button.

While dragging, the source tab dims to 35%, a copy follows the pointer, and a 2px `accent` line sits in the gap beside the target, 4px outside its edge, clear of any tab border.

The ⋮ menu is a 240px popup on `popover` with 5px padding and 32px rows, listing hidden buttons alphabetically, each with a 22px pin button.

## How it behaves

A press becomes a drag only after 400ms and 12px of movement, for tabs and toolbar buttons alike; anything less is a click. Nothing moves until release. Leaving the bar cancels a drag. Dropping a tab on + puts it last. A tab's click selects it, double-click renames it through `tab.rename`, and right-click opens the shipped `menu` mod. `tab.move` takes a one-based index.

Dropping a toolbar button on ⋮ hides it. In the menu, clicking a row runs its action, dragging out closes the menu so it can be dropped on the toolbar, and the pin restores it at the front. Buttons that don't fit the width also go in the menu. The arrangement is saved by button ID, per layout, in `shared("better-tabs.toolbar")`.

Tabs use a wrapping flex row whose measured height resizes the bar with `layout.resize` on `tabs-row` if it exists, else `tabs`. Measured sizes are scaled by zoom, so divide by `settings().zoom`.

Panel memory saves each space's open panel in localStorage and restores it on returning, outside render.

Actions are `panel` (`container`, `stack`, `target`) and `command` (`name`, `args`). Errors become notifications.

## Built from

One folder, `mods/better-tabs/`: `main.js`, `settings.js`, `mod.json` (`place: none`), `actions/` (`engine.js`, `toolbar.js`), `views/` (`tab-bar.js`, `menu.js`, `drags.js`, `arrangement.js`, `panel-memory.js`, `ui.js`) and `icons/`. It uses `div`, `svg`, `image`, flex containers and popups through `openOverlay`. It runs no programs. Mod tabs show the icon in `shared("mod-icons")[mod]`. On macOS it leaves room for the traffic lights when the sidebar doesn't.

## Watch out

GPUI gives pointer events, not a drag payload, and the popup is another copy of the mod, so toolbar drags live in shared state and tab drags stay local.

`stop_propagation()` in a button's `on_click` can stop its `on_mouse_up` from running, which leaves a drag open and stuck to the pointer. End the drag in `on_click` too.

Keep the bar's own gap wider than the drop line, or the line touches a tab's border. Never call `run` or `setShared` during render.

Copying the folder is not enough: shipped layouts are read-only, so point a tabs block in a layout the person owns at `better-tabs`, preserving its size and `window_drag`.

## Done when

- `node --test tests/*.test.cjs` and `herdr-app check` pass.
- A quick click selects a tab or runs a button, and nothing follows the pointer afterwards.
- Dragging shows the line between tabs and moves on release; leaving the bar cancels.
- Many tabs wrap, the bar grows, + stays after the last tab, and the bar shrinks back when tabs close.
- Dropping a button on ⋮ hides it, and the pin or a drag brings it back, surviving a restart.
