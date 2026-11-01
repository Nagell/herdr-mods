const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("package uses only its own assets and has the standalone docking manifest", () => {
  const source = fs.readFileSync("mods/better-changes/main.js", "utf8");
  assert.doesNotMatch(source, /factory-changes|mods\/pull-requests|mods\/factory-tabs/);
  for (const path of [...source.matchAll(/"(mods\/better-changes\/[a-z-]+\.svg)"/g)].map(
    (m) => m[1],
  ))
    assert.ok(fs.existsSync(path), path);
  const manifest = JSON.parse(fs.readFileSync("mods/better-changes/mod.json"));
  assert.equal(manifest.place, "right");
  assert.equal(manifest.title, "Better Changes");
  assert.equal(fs.existsSync("layouts"), false);
});
