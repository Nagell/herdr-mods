const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const SHIPPED = new Set(['files', 'workspace-chrome', 'workspace-status']);

const layout = JSON.parse(fs.readFileSync(path.join(root, 'layouts/estro.json')));
const blocks = (node) => [...(node.content?.mod ? [node] : []), ...(node.children ?? []).flatMap(blocks)];

test('every mod the layout names is here or ships with Herdr', () => {
  const named = new Set(blocks(layout).map((b) => b.content.mod));
  for (const mod of named) assert.ok(SHIPPED.has(mod) || fs.existsSync(path.join(root, 'mods', mod, 'RECIPE.md')), mod);
  for (const mod of fs.readdirSync(path.join(root, 'mods'))) assert.ok(named.has(mod), `${mod} is unused`);
});

test('every toolbar button points at a panel and an icon that exist', () => {
  const tabs = blocks(layout).find((b) => b.content.mod === 'better-tabs');
  const ids = new Set(blocks(layout).map((b) => b.id));
  for (const button of tabs.content.props.buttons) {
    assert.ok(ids.has(button.action.target), button.id);
    if (button.icon.startsWith('mods/')) assert.ok(fs.existsSync(path.join(root, '..', button.icon.split('/')[1], button.icon)), button.icon);
  }
});

test('mods/ holds a pointer to each mod, and no copies', () => {
  for (const mod of fs.readdirSync(path.join(root, 'mods'))) {
    assert.deepEqual(fs.readdirSync(path.join(root, 'mods', mod)), ['RECIPE.md'], mod);
    assert.match(fs.readFileSync(path.join(root, 'mods', mod, 'RECIPE.md'), 'utf8'), new RegExp(`add this mod: https://github.com/munza/herdr-mods/tree/main/${mod}\\n`));
    assert.ok(fs.existsSync(path.join(root, '..', mod, 'mods', mod, 'mod.json')), `${mod} has a real home`);
  }
});

test('the layout holds nothing personal and opens with its panel showing', () => {
  const text = fs.readFileSync(path.join(root, 'layouts/estro.json'), 'utf8');
  assert.doesNotMatch(text, /\/Users\/|munza|tawsif/i);
  assert.match(fs.readFileSync(path.join(root, 'RECIPE.md'), 'utf8'), /preview\.png/);
  const panel = (function find(n) { return n.id === 'panel' ? n : (n.children ?? []).map(find).find(Boolean); })(layout);
  assert.equal(panel.hidden, undefined);
});
