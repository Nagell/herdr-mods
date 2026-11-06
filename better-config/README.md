# Better Config

Every installed mod's settings in one dialog for [Herdr Desktop](https://herdr.dev/), drawn like Herdr's own Settings. No more hand-editing each mod's `mod.json` or reading its README to learn what a key does.

![Better Config](preview.png)

- **One place:** each mod with settings gets a page, with every setting's name, what it does and its key.
- **The right control:** on/off switches, buttons or a dropdown for a fixed set of choices, − and + for numbers, and text boxes for times (`450ms`, `10s`), sizes (`60KB`), text and lists.
- **Checked before saving:** a value that doesn't fit is explained under its field and never written. A bad value someone typed into `mod.json` by hand shows there too, instead of only in a log.
- **Applies at once:** a change is saved to the mod's own `mod.json`, and Herdr reloads the mod straight away.
- **See what you changed:** a dot marks every setting you've changed. **Reset** puts one back, and **Reset all** puts a whole mod back.
- **Survives updates:** updating a mod replaces its `mod.json`, which used to throw your settings away. Better Config keeps a copy of what you changed, notices when an update put the defaults back, and lists each one, yours beside the current value, with a tick to choose which to restore and which to keep as they are now.
- **Works with any mod:** a mod that ships a schema of its settings (below) gets names, descriptions and checks. Any other mod with a `settings` block still shows, with its types guessed.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-config

[RECIPE.md](RECIPE.md) guides the install. It's a dialog, so it needs no place in a layout.

## Open it

Herdr's command palette doesn't list mods, so give it a key. [keys.json](keys.json) suggests **⌘⌥,**, next to Herdr's own **⌘,** for Settings. Merge it into `~/.config/herdr-app/keys.json`:

```json
{ "global": { "cmd-alt-,": "mod.open:better-config" } }
```

Herdr stops adding new default shortcuts to a `keys.json` you've edited, so if you've never changed yours, this is the edit that makes it yours. Without a key, `herdr-app do mod.open '{"name":"better-config"}'` opens it too. The same key, or Esc, closes it.

## Where values live

Values stay where each mod already reads them: the `settings` block of its installed `mod.json`, which holds only what you changed. A change back to the default removes the key. Nothing about a mod changes, and a mod works the same with or without Better Config.

Better Config also keeps a copy of only what you changed in `~/.config/herdr-mods/better-config/<mod>.json`, outside every mod's folder. When a kept value is missing from `mod.json`, or is back at its default, it asks whether to restore it. A value you changed by hand to something else is taken as yours, and the copy follows it. Every write goes through only if the file hasn't changed since it was read, so it never overwrites an edit made meanwhile.

## Describe a mod's settings

A mod describes its `mod.json` in a JSON Schema beside it, `mods/<name>/mod.schema.json`, and `mod.json` points at it, so editors check the file too:

```json
{ "$schema": "./mod.schema.json", "version": "1.0.0", "place": "none", "title": "My Mod" }
```

The schema describes Herdr's own fields and, under `properties.settings`, each setting, nested the way `settings` is:

```json
"settings": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "refresh": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "every": { "title": "Refresh", "description": "How often the panel rereads.", "type": ["string", "integer"], "format": "duration", "default": "60s" }
      }
    },
    "page_size": { "title": "Page size", "description": "How many load at a time.", "type": "integer", "minimum": 1, "maximum": 100, "x-step": 5, "default": 25 },
    "view": { "title": "View", "description": "How the list starts.", "type": "string", "enum": ["tree", "flat"], "x-labels": { "tree": "Tree", "flat": "Flat" }, "default": "tree" }
  }
}
```

| Keyword | Meaning |
|---|---|
| `title`, `description` | What the dialog shows. The title defaults to the key's last part. |
| `default` | What the mod uses when nothing is set. Keep it equal to the default in the mod's code. **Reset** removes the key so the mod uses it. |
| `type` | `boolean`; `integer` or `number`; `string`; `array` of strings for a list. |
| `enum` | A fixed set of choices. Up to four show as buttons, more as a dropdown. `x-labels` names them: `{ "value": "Label" }`. |
| `format` | `duration` (`450ms`, `10s`) or `size` (`60KB`), with `type: ["string", "integer"]` since a bare number is also accepted. Add a `pattern` so editors check it. |
| `minimum`, `maximum` | A number's limits. `x-step` is how far − and + move it, `x-unit` a unit shown beside it, such as `px`. |

The shipped `mod.json` has no `settings` block: it holds only what a person changes, and the mod uses its own defaults for the rest. Every mod in this repository ships a schema, and a test checks that each `mod.json` passes it and its defaults equal the mod's code.

## Limits

- **Mods with settings only:** a mod with no `settings` in its `mod.json` and none described in a `mod.schema.json` doesn't appear.
- **Only the keywords above:** the schema's settings are read for those keywords. `oneOf`, `$ref` and the like are ignored.
- **Not Herdr's own settings:** **Herdr settings**, at the bottom of the list, opens those.
- **Settings without a described default:** only a version change shows an update took them, so a reinstall of the same version goes unnoticed.
- **Nested objects:** values that are objects show as their separate keys. A list holds words only.

## Development

```sh
node --test tests/*.test.cjs
./sync.sh
herdr-app check "$HOME/.config/herdr-app/mods/better-config"
```

`mods/better-config/model.js` holds everything that doesn't touch Herdr, and the tests run it as it is. Tests can't draw the dialog, so also look at the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
