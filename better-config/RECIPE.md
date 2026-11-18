# Better Config

A dialog that shows and changes every installed mod's settings, for a person who shouldn't have to hand-edit JSON. Judge any addition by whether it makes a mod's settings easier to find, understand, change safely or get back. It never changes how a mod reads its settings.

## What you see

A dialog overlay, 860 by 620, the same look as Herdr's own Settings: a 190px list on the left titled Mod settings, an Installed mods row and a divider at the top, then one plain-text row per mod with a red dot when it needs attention, and Herdr settings at the bottom. On the right, a scrolling page for the chosen mod: its title and version, Reset all when anything differs from the default, and where it's saved.

Below, the mod's settings in rows, grouped under a heading by the first part of their key, keys with one part first. A row has the title, its description and the key in the code font on the left, a dot after the title when it differs from the default, then Reset, then the control: a switch for on/off; segments for up to four choices, else a dropdown with ↑, ↓, Enter and Esc; − value + for a number; a text box for times, sizes, text and comma-separated lists, which saves on Enter or when it loses focus. A value that doesn't fit is explained in red under its row.

When an update, or anything else, has put defaults back over the person's values, a box at the top says which (naming the versions when the version changed) and lists each setting as a checkbox row, ticked to start: the person's value, an arrow, the current one, with "(default)" when it's unset, and choice labels rather than ids. One button restores the ticked ones and keeps the rest, named for what it will do: Restore mine, Keep the new values, or Restore 1, keep 1. The copy then forgets the ones kept.

Installed mods is a page of every folder in `mods/`, with a count. Two segments, Yours and Herdr's with their counts, split the person's own mods from those Herdr ships, and a 220px search box at the right filters the tab by title or folder, ignoring case. Each row has the title over the folder in the code font, the version, In this layout, Opens by key or Not used here, and a Settings button when the mod has a settings page. An empty tab says No mods here; an empty search says No mods match your search.

## How it works

It lists the folders in `~/.config/herdr-app/mods/` and reads each `mod.json` and the `mod.schema.json` beside it, keeping those with settings in either. Under the schema's `properties.settings`, each leaf is a setting at its dotted key, read for `title`, `description`, `type`, `default`, `enum`, `minimum`, `maximum`, `format` (`duration`, `size`), `x-step`, `x-unit` and `x-labels`. A key in `settings` the schema doesn't describe still shows, with its type guessed from its value.

A change edits only that key in the mod's `mod.json` and writes the whole file with `writeTextFile`, passing the text it read, so it fails if the file changed meanwhile; then it rereads and tries again, up to three times, as Herdr's Settings does with `settings.json`. Herdr reloads a mod when its `mod.json` is saved. A value equal to the default, and so Reset, removes the key, and an empty `settings` block goes too: `settings` holds only what the person changed.

`~/.config/herdr-mods/better-config/<mod>.json` holds `{ version, values }`: the dotted keys that differ from their defaults. After each write it's updated at once. On each read, a kept value that's gone from `mod.json`, or back at its default, or different after a version change, is lost: the page offers to restore it. Anything else that differs is a hand edit, and the copy follows the file. It rereads every 3 seconds while open.

Herdr's own mods are the keys of `~/.config/herdr-app/installed.json`, leaving out `layout:` keys. A mod is In this layout when any node of `layout()` names it in `mod`, `toast` or `terminal_menu`, and Opens by key when a binding in `keys.json` is `mod.open:<name>`, starts with `<name>.`, or is a `mod.open` command with that name. Both are reread with the mods.

Text boxes are made after each read, never during a render, which Herdr forbids. The dropdown is base's `Select` with a `Popup`, and moves the keyboard onto its list when opened by a click.

## Built from

`mods/better-config/`: `main.js` (the dialog), `model.js` (fields, checks, typed input, what changed and what was lost; no Herdr calls), `mod.json` (`place: none`, title Better Config, a dialog `overlay`), `mod.schema.json`, `icons/` (Lucide chevron-down, check). `keys.json` suggests a key. The look follows Herdr's `frame/settings/main.js`.

## Watch out

Merge `keys.json` into the person's only when they agree: Herdr stops updating the default shortcuts of a `keys.json` that's been edited. Never overwrite an unrelated mod on a name clash.

## Done when

- `herdr-app check` passes and `mod.open better-config` shows every mod that has settings.
- Changing a setting writes only that key to the mod's `mod.json`, and the mod reloads with it.
- A value that doesn't fit is explained and not written.
- Installed mods lists every mod folder under the right tab, the search narrows it, and Settings opens that mod's page.
- Copying a mod's shipped `mod.json` over the installed one brings up the box listing them, and Restore mine puts the values back. With one unticked, only the ticked one comes back, and the copy forgets the other.
