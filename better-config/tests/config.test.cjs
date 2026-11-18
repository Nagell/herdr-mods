// Better Config's model: describing settings, checking values, and noticing values an update took.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, "mods/better-config/model.js"), "utf8"))}`);

const schema = {
  properties: {
    settings: {
      type: "object",
      properties: {
        refresh: { type: "object", properties: { tree: { title: "Tree refresh", type: ["string", "integer"], format: "duration", default: "10s" } } },
        gutter: { type: "boolean", default: true },
        limits: { type: "object", properties: { files: { type: "integer", default: 1000, minimum: 1 } } },
        default: { type: "object", properties: { diff: { type: "string", enum: ["inline", "split"], "x-labels": { split: "Side by side" }, default: "inline" } } },
        editors: { type: "array", items: { type: "string" }, default: [] },
      },
    },
  },
};
const manifest = { version: "1.0.0", settings: { refresh: { tree: "30s" }, gutter: true, extra: { thing: 5 } } };
const fieldsFor = async (m = manifest) => (await load()).fieldsOf(schema, m.settings);
const byKey = async () => Object.fromEntries((await fieldsFor()).map((x) => [x.key, x]));

test("fields: described ones in order, then the rest with a guessed type", async () => {
  const fields = await fieldsFor();
  assert.deepEqual(fields.map((f) => f.key), ["refresh.tree", "gutter", "limits.files", "default.diff", "editors", "extra.thing"]);
  assert.equal(fields[0].type, "duration");
  assert.equal(fields[2].type, "number");
  assert.equal(fields[2].min, 1);
  assert.equal(fields[3].type, "choice");
  assert.deepEqual(fields[3].choices, { inline: "Inline", split: "Side by side" });
  assert.equal(fields[4].type, "list");
  assert.equal(fields[5].described, false);
  assert.equal(fields[5].type, "number");
  assert.equal(fields[5].title, "Thing");
  assert.equal((await load()).fieldsOf(null, { a: true })[0].type, "boolean");
});

test("values are checked against their field", async () => {
  const { problemWith } = await load();
  const f = await byKey();
  assert.equal(problemWith(f["refresh.tree"], "450ms"), null);
  assert.equal(problemWith(f["refresh.tree"], 450), null);
  assert.match(problemWith(f["refresh.tree"], "soon"), /time/);
  assert.match(problemWith(f["limits.files"], 0), /at least 1/);
  assert.match(problemWith(f["default.diff"], "stacked"), /inline, split/);
  assert.match(problemWith(f.gutter, "yes"), /on or off/);
  assert.equal(problemWith(f.gutter, undefined), null);
});

test("typed text becomes the right value, or says why not", async () => {
  const { parseInput } = await load();
  const f = await byKey();
  assert.deepEqual(parseInput(f.editors, " dev.zed.Zed, , com.example.App "), { value: ["dev.zed.Zed", "com.example.App"] });
  assert.deepEqual(parseInput(f.editors, ""), { value: [] });
  assert.deepEqual(parseInput(f["limits.files"], "250"), { value: 250 });
  assert.ok(parseInput(f["limits.files"], "lots").error);
  assert.deepEqual(parseInput(f["refresh.tree"], "500"), { value: 500 });
});

test("only values that differ from the default count as changed", async () => {
  const { changedValues } = await load();
  assert.deepEqual(changedValues(await fieldsFor(), manifest.settings), { "refresh.tree": "30s" });
});

test("editing keeps the rest of mod.json; the default or nothing removes the key", async () => {
  const { editManifest } = await load();
  const f = await byKey();
  const raw = JSON.stringify({ version: "1", place: "none", settings: { refresh: { tree: "30s" } } });
  assert.deepEqual(JSON.parse(editManifest(raw, f.gutter, false)), { version: "1", place: "none", settings: { refresh: { tree: "30s" }, gutter: false } });
  assert.deepEqual(JSON.parse(editManifest(raw, f["refresh.tree"], "10s")), { version: "1", place: "none" });
  assert.deepEqual(JSON.parse(editManifest(raw, f["refresh.tree"], undefined)), { version: "1", place: "none" });
  assert.deepEqual(JSON.parse(editManifest(JSON.stringify({ version: "1" }), f["limits.files"], 5)).settings, { limits: { files: 5 } });
});

test("an update that put defaults back is noticed; an edit by hand is not", async () => {
  const { lostValues } = await load();
  const fields = await fieldsFor();
  const kept = { version: "1.0.0", values: { "refresh.tree": "30s" } };
  // An update ships mod.json without your settings.
  assert.deepEqual(lostValues(kept, fields, { version: "1.1.0" }), { "refresh.tree": "30s" });
  assert.deepEqual(lostValues(kept, fields, { version: "1.0.0", settings: { refresh: { tree: "10s" } } }), { "refresh.tree": "30s" });
  // Same version, a different non-default value: the person edited it by hand.
  assert.deepEqual(lostValues(kept, fields, { version: "1.0.0", settings: { refresh: { tree: "5s" } } }), {});
  assert.deepEqual(lostValues(kept, fields, manifest), {});
  assert.deepEqual(lostValues(null, fields, { version: "1.1.0" }), {});
});

// The defaults a mod's code falls back to: its DEFAULT_SETTINGS object literal.
function codeDefaults(folder) {
  for (const file of fs.readdirSync(folder, { recursive: true }).filter((f) => f.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(folder, file), "utf8");
    const at = text.indexOf("const DEFAULT_SETTINGS = {");
    if (at < 0) continue;
    let depth = 0, i = text.indexOf("{", at);
    const start = i;
    for (; i < text.length; i++) if (text[i] === "{") depth++; else if (text[i] === "}" && --depth === 0) break;
    return Function(`return (${text.slice(start, i + 1)})`)();
  }
  return null;
}

// Checks a value against a JSON Schema node, for the keywords these schemas use.
function check(node, value, at, problems) {
  const types = [node.type].flat().filter(Boolean);
  const is = { string: typeof value === "string", boolean: typeof value === "boolean", number: typeof value === "number", integer: Number.isInteger(value), array: Array.isArray(value), object: value !== null && typeof value === "object" && !Array.isArray(value) };
  if (types.length && !types.some((t) => is[t])) return problems.push(`${at} should be ${types.join(" or ")}`);
  if (node.enum && !node.enum.includes(value)) problems.push(`${at} should be one of ${node.enum}`);
  if (typeof value === "string" && node.pattern && !new RegExp(node.pattern).test(value)) problems.push(`${at} doesn't match`);
  if (typeof value === "number" && node.minimum !== undefined && value < node.minimum) problems.push(`${at} too small`);
  if (typeof value === "number" && node.maximum !== undefined && value > node.maximum) problems.push(`${at} too big`);
  if (is.array && node.items) value.forEach((v, i) => check(node.items, v, `${at}[${i}]`, problems));
  if (is.object && node.properties)
    for (const [key, v] of Object.entries(value)) {
      if (node.properties[key]) check(node.properties[key], v, `${at}.${key}`, problems);
      else if (node.additionalProperties === false) problems.push(`${at}.${key} isn't a setting`);
    }
  return problems;
}

// Every mod in this repository describes each of its settings, with the defaults its code uses.
test("this repository's mods ship a schema their mod.json passes, with their code's defaults", async () => {
  const { fieldsOf, flatten, problemWith } = await load();
  const repo = path.join(root, "..");
  const mods = fs.readdirSync(repo).filter((dir) => fs.existsSync(path.join(repo, dir, "mods", dir, "mod.json")));
  assert.ok(mods.length >= 7);
  for (const name of mods) {
    const folder = path.join(repo, name, "mods", name);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "mod.json"), "utf8"));
    assert.equal(manifest.$schema, "./mod.schema.json", `${name}: mod.json should point at its schema`);
    assert.equal(manifest.settings, undefined, `${name}: mod.json should ship without settings, which hold only a person's changes`);
    assert.ok(!("config" in manifest), `${name}: config moved to mod.schema.json`);
    const modSchema = JSON.parse(fs.readFileSync(path.join(folder, "mod.schema.json"), "utf8"));
    assert.deepEqual(check(modSchema, manifest, "mod.json", []), [], `${name}: mod.json doesn't pass its schema`);
    const fields = fieldsOf(modSchema, {});
    for (const f of fields) {
      assert.ok(f.title && f.description, `${name}: ${f.key} needs a title and description`);
      assert.notEqual(f.default, undefined, `${name}: ${f.key} needs a default`);
      assert.equal(problemWith(f, f.default), null, `${name}: ${f.key}'s default doesn't fit its type`);
    }
    const settingsSchema = modSchema.properties.settings;
    if (settingsSchema) {
      const defaults = {};
      for (const f of fields) defaults[f.key] = f.default;
      const nested = {};
      for (const [k, v] of Object.entries(defaults)) k.split(".").reduce((o, p, i, a) => (o[p] ??= i === a.length - 1 ? v : {}), nested);
      assert.deepEqual(check(settingsSchema, nested, "defaults", []), [], `${name}: its defaults don't pass its schema`);
    }
    const code = codeDefaults(folder);
    if (!code) continue;
    const described = Object.fromEntries(fields.map((f) => [f.key, f.default]));
    for (const [key, value] of Object.entries(flatten(code)))
      assert.deepEqual(described[key], value, `${name}: ${key} defaults to ${JSON.stringify(value)} in code but ${JSON.stringify(described[key])} in mod.schema.json`);
    assert.deepEqual(Object.keys(described).sort(), Object.keys(flatten(code)).sort(), `${name}: schema and code know different settings`);
  }
});

// The Installed page. The layout and keys are shaped like Herdr's, with made-up mods.
const LAYOUT = {
  id: "root",
  type: "row",
  toast: "quiet-toast",
  floating: [{ id: "alerts", content: { mod: "lantern-alerts" }, edge: "bottom", align: "end" }],
  children: [
    { id: "sidebar", type: "block", content: { mod: "lantern-sidebar" } },
    { id: "main", type: "block", content: { tab: "active", terminal_menu: "lantern-menu", pane: { header: { content: { mod: "lantern-header" } } } } },
  ],
};
const KEYS = { global: { "super-.": "mod.open:lantern-config", "super-e": "lantern-files.focus", "super-p": { command: "mod.open", args: { name: "lantern-picker" } } } };

test("a mod is used by the layout, by a key, or neither", async () => {
  const { modUse } = await load();
  for (const name of ["lantern-sidebar", "lantern-header", "lantern-alerts", "quiet-toast", "lantern-menu"]) assert.equal(modUse(name, LAYOUT, KEYS), "layout", name);
  for (const name of ["lantern-config", "lantern-files", "lantern-picker"]) assert.equal(modUse(name, LAYOUT, KEYS), "key", name);
  assert.equal(modUse("lantern-icons", LAYOUT, KEYS), null);
  // A name that only starts like another's isn't it.
  assert.equal(modUse("lantern", LAYOUT, KEYS), null);
  assert.equal(modUse("lantern-side", LAYOUT, KEYS), null);
  // A block in the layout wins over a key.
  assert.equal(modUse("lantern-sidebar", LAYOUT, { global: { x: "mod.open:lantern-sidebar" } }), "layout");
  assert.equal(modUse("lantern-sidebar", null, null), null);
});

test("Herdr's own mods are the ones its installed.json records, not its layouts", async () => {
  const { shippedMods } = await load();
  const installed = { agents: { "main.js": "1a" }, toast: { "main.js": "2b" }, "layout:main": { json: "3c" } };
  assert.deepEqual([...shippedMods(installed)].sort(), ["agents", "toast"]);
  assert.deepEqual([...shippedMods(null)], []);
});

test("installed mods list yours first, then Herdr's, each by title", async () => {
  const { installedRows } = await load();
  const rows = installedRows(
    [
      { name: "toast", manifest: { place: "none" } },
      { name: "lantern-tabs", manifest: { title: "Lantern Tabs", version: "2.0.0" } },
      { name: "agents", manifest: { title: "Agents" } },
      { name: "broken", manifest: null },
      { name: "lantern-alerts", manifest: { title: "Lantern Alerts", version: "1.0.0" } },
      { name: "odd-title", manifest: { title: 3, version: 2 } },
      { name: "half-copied", manifest: null, missing: true },
    ],
    new Set(["toast", "agents"]),
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.title, r.version, r.herdr, r.missing]),
    [
      ["broken", "broken", null, false, false],
      ["half-copied", "half-copied", null, false, true],
      ["lantern-alerts", "Lantern Alerts", "1.0.0", false, false],
      ["lantern-tabs", "Lantern Tabs", "2.0.0", false, false],
      ["odd-title", "odd-title", null, false, false],
      ["agents", "Agents", null, true, false],
      ["toast", "toast", null, true, false],
    ],
  );
});

test("a mod's title is its mod.json title when that's text, else its folder", async () => {
  const { modTitle } = await load();
  assert.equal(modTitle("lantern-tabs", { title: "Lantern Tabs" }), "Lantern Tabs");
  assert.equal(modTitle("lantern-tabs", { title: 3 }), "lantern-tabs");
  assert.equal(modTitle("lantern-tabs", { title: { en: "Lantern Tabs" } }), "lantern-tabs");
  assert.equal(modTitle("lantern-tabs", { title: "  " }), "lantern-tabs");
  assert.equal(modTitle("lantern-tabs", null), "lantern-tabs");
});

test("the Installed tabs and search: yours or Herdr's, matching the title or folder, case aside", async () => {
  const { installedRows, filterInstalled } = await load();
  const rows = installedRows(
    [
      { name: "lantern-tabs", manifest: { title: "Lantern Tabs" } },
      { name: "lantern-alerts", manifest: { title: "Lantern Alerts" } },
      { name: "trail-notes", manifest: null },
      { name: "agents", manifest: { title: "Agents" } },
      { name: "toast", manifest: null },
    ],
    new Set(["agents", "toast"]),
  );
  const names = (tab, query) => filterInstalled(rows, tab, query).map((r) => r.name);
  assert.deepEqual(names("yours", ""), ["lantern-alerts", "lantern-tabs", "trail-notes"]);
  assert.deepEqual(names("herdr", ""), ["agents", "toast"]);
  assert.deepEqual(names("yours", "  ALERTS "), ["lantern-alerts"]);
  assert.deepEqual(names("yours", "lantern-al"), ["lantern-alerts"], "the folder name matches too");
  assert.deepEqual(names("yours", "lantern al"), ["lantern-alerts"], "the title matches, case aside");
  assert.deepEqual(names("herdr", "lantern"), []);
});
