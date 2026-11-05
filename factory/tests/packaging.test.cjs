const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/factory');

const files = () => ['main.js', 'settings.js', ...['views', 'actions', 'run'].flatMap((d) => fs.readdirSync(path.join(runtime, d)).map((f) => `${d}/${f}`))];

test('package owns its helper and depends on no other mod or layout', () => {
  const code = files().map((f) => fs.readFileSync(path.join(runtime, f), 'utf8')).join('\n');
  assert.doesNotMatch(code, /better-tabs|branch-pr|branch-issue|panel-body|collie/i);
  assert.match(code, /appHome\(\)\}\/mods\/factory\/bin\/factory/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'Factory');
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/install/main.go', 'skills/factory/SKILL.md', 'README.md', 'RECIPE.md'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.equal(fs.existsSync(path.join(runtime, 'bin')), false, 'binaries are built on install');
});

test('every icon is used and every used icon exists', () => {
  const code = files().map((f) => fs.readFileSync(path.join(runtime, f), 'utf8')).join('\n');
  const icons = fs.readdirSync(path.join(runtime, 'icons')).map((f) => f.replace('.svg', ''));
  for (const icon of icons) assert.ok(code.includes(`"${icon}"`), `unused icon ${icon}`);
  for (const [, name] of code.matchAll(/(?:icon: |Icon\()"([a-z-]+)"/g)) assert.ok(icons.includes(name), `missing icon ${name}`);
});

test('the sidebar never shows a task', () => {
  const code = files().map((f) => fs.readFileSync(path.join(runtime, f), 'utf8')).join('\n');
  assert.doesNotMatch(code, /run\.task|\.task\b/);
});
