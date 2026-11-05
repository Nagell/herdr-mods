const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const SHIPPED = new Set(['files', 'workspace-chrome', 'workspace-status']);

const layout = JSON.parse(fs.readFileSync(path.join(root, 'layouts/estro.json')));
const blocks = (node) => [...(node.content?.mod ? [node] : []), ...(node.children ?? []).flatMap(blocks)];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const IGNORED = new Set(['gpui-kit.d.ts', 'herdr.d.ts', 'jsconfig.json', '.DS_Store']);
const files = (dir) => walk(dir).filter((f) => !IGNORED.has(path.basename(f)) && !path.relative(dir, f).startsWith('bin/')).map((f) => path.relative(dir, f)).sort();

test('every mod the layout names is here or ships with Herdr', () => {
  const named = new Set(blocks(layout).map((b) => b.content.mod));
  for (const mod of named) assert.ok(SHIPPED.has(mod) || fs.existsSync(path.join(root, 'mods', mod, 'mod.json')), mod);
  for (const mod of fs.readdirSync(path.join(root, 'mods'))) assert.ok(named.has(mod), `${mod} is unused`);
});

test('every toolbar button points at a panel and an icon that exist', () => {
  const tabs = blocks(layout).find((b) => b.content.mod === 'better-tabs');
  const ids = new Set(blocks(layout).map((b) => b.id));
  for (const button of tabs.content.props.buttons) {
    assert.ok(ids.has(button.action.target), button.id);
    if (button.icon.startsWith('mods/')) assert.ok(fs.existsSync(path.join(root, button.icon)), button.icon);
  }
});

test('the copies match the mods, with no binaries', () => {
  for (const mod of fs.readdirSync(path.join(root, 'mods'))) {
    const copy = path.join(root, 'mods', mod), source = path.join(root, '..', mod, 'mods', mod);
    assert.deepEqual(files(copy), files(source), `${mod}: run sync.sh`);
    for (const file of files(copy)) assert.ok(fs.readFileSync(path.join(copy, file)).equals(fs.readFileSync(path.join(source, file))), `${mod}/${file}: run sync.sh`);
    assert.equal(fs.existsSync(path.join(copy, 'bin')), false);
  }
});

test('the layout holds nothing personal and opens with its panel showing', () => {
  const text = fs.readFileSync(path.join(root, 'layouts/estro.json'), 'utf8');
  assert.doesNotMatch(text, /\/Users\/|munza|tawsif/i);
  assert.match(fs.readFileSync(path.join(root, 'RECIPE.md'), 'utf8'), /preview\.png/);
  const panel = (function find(n) { return n.id === 'panel' ? n : (n.children ?? []).map(find).find(Boolean); })(layout);
  assert.equal(panel.hidden, undefined);
});
