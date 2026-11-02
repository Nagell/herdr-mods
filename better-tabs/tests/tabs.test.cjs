const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../mods/better-tabs');

function harness(config = {}) {
  const calls = [], data = {}, storage = new Map(), timers = [];
  const tree = { id: 'root', children: [
    { id: 'panel', hidden: false, children: [{ id: 'panel-body', active: 'files', children: [{ id: 'files' }, { id: 'changes' }] }] },
    { id: 'center', active: 'main', children: [{ id: 'main' }, { id: 'browser' }] },
  ] };
  let spaces = [{ id: 'a', active: true, tabs: [{ id: 't1', name: 'One', active: true }, { id: 't2', name: 'Two' }] }];
  function element() {
    const value = { kids: [], handlers: {} };
    const proxy = new Proxy(value, { get(o, k) {
      if (k in o) return o[k];
      return (...args) => {
        if (k === 'child') o.kids.push(args[0]);
        else if (k === 'children') o.kids.push(...args[0]);
        else if (k === 'when') { if (args[0]) args[1](proxy); }
        else if (k === 'id') o.key = args[0];
        else if (k.startsWith('on_')) o.handlers[k + (typeof args[0] === 'string' ? ':' + args[0] : '')] = args.at(-1);
        return proxy;
      };
    } });
    return proxy;
  }
  const context = { View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
    em: n => n * 14, props: () => config, layout: () => tree, spaces: () => spaces, panes: () => [],
    shared: key => data[key], setShared: (key, value) => data[key] = value,
    run: (name, args) => calls.push({ name, args }), openOverlay: args => calls.push({ overlay: args }),
    closeOverlay: id => calls.push({ close: id }), notify: args => calls.push({ notify: args }),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    window: () => ({ platform: 'macos' }), settings: () => ({ zoom: 1 }), theme: () => ({}),
    nextCommand: () => new Promise(() => {}), Date, console,
  };
  vm.createContext(context);
  const load = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').replace('export const hooks', 'const hooks').replace('export default class Tabs', 'globalThis.Tabs = class Tabs');
  vm.runInContext(load('hooks.js') + '\n' + load('actions.js') + '\n' + load('main.js') + '\nglobalThis.api = {execute, buttons, matches, isActive, find, hooks};', context);
  const cx = { spawn: () => {}, notify: () => {}, stop_propagation: () => {}, timer: { every: (ms, fn) => timers.push(fn) } };
  const tabs = new context.Tabs(); tabs.init({}, cx);
  function find(el, id) { if (el?.key === id) return el; for (const child of el?.kids ?? []) { const found = find(child, id); if (found) return found; } }
  return { ...context.api, tabs, context, calls, data, tree, config, storage, timers, cx, find, setSpaces: s => spaces = s };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('panel actions toggle containers and reject missing targets without dispatch', () => {
  const h = harness(), action = { type: 'panel', container: 'panel', stack: 'panel-body', target: 'changes' };
  h.execute(action); assert.deepEqual(plain(h.calls), [{ name: 'layout.select', args: { stack: 'panel-body', child: 'changes' } }, { name: 'layout.show', args: { id: 'panel' } }]);
  h.findNode = h.tree.children[0].children[0]; h.findNode.active = 'changes'; h.execute(action);
  assert.equal(h.calls.at(-1).name, 'layout.hide');
  const count = h.calls.length; assert.throws(() => h.execute({ ...action, target: 'missing' })); assert.equal(h.calls.length, count);
});
test('generic stack toggle preserves other layout children', () => {
  const h = harness(), action = { type: 'toggle-stack', stack: 'center', child: 'browser', fallback: 'main' };
  h.execute(action); assert.equal(h.calls.at(-1).args.child, 'browser');
  h.tree.children[1].active = 'browser'; h.execute(action); assert.equal(h.calls.at(-1).args.child, 'main');
});
test('commands, overlays, shared updates, and sequences dispatch in order', () => {
  const h = harness(); h.execute({ type: 'sequence', actions: [
    { type: 'command', name: 'tab.new', args: { name: 'Example' } },
    { type: 'overlay', mod: 'example', kind: 'dialog', props: { x: 1 } },
    { type: 'shared', key: 'example.flag', toggle: true },
  ] });
  assert.equal(h.calls[0].name, 'tab.new'); assert.equal(h.calls[1].overlay.mod, 'example'); assert.equal(h.data['example.flag'], true);
});
test('sequences have a recursion bound and hooks are explicit trusted handlers', () => {
  const h = harness(); const loop = { type: 'sequence' }; loop.actions = [loop]; assert.throws(() => h.execute(loop), /nested/);
  assert.throws(() => h.execute({ type: 'hook', name: 'toString' }), /Unknown/);
  h.hooks.example = (args, context) => { assert.equal(args.x, 1); assert.equal(context.space, 'a'); };
  h.execute({ type: 'hook', name: 'example', args: { x: 1 } }, { space: 'a' });
});
test('async hook failures are reported directly and inside action sequences', async () => {
  const h = harness(); h.hooks.fail = async () => { throw Error('Hook failed'); };
  h.tabs.act({ type: 'hook', name: 'fail' }, h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.calls.at(-1).notify.body, /Hook failed/);
  h.calls.length = 0;
  h.tabs.act({ type: 'sequence', actions: [{ type: 'hook', name: 'fail' }, { type: 'command', name: 'tab.new' }] }, h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[0].name, 'tab.new'); assert.match(h.calls.at(-1).notify.body, /Hook failed/);
});

test('contributions are opt-in; layout IDs win and predicates/order apply', () => {
  const h = harness(), config = { buttons: [{ id: 'own', label: 'Own', order: 5 }] };
  const extra = { mod: [{ id: 'own', label: 'Wrong' }, { id: 'other', order: 1 }, { id: 'hidden', when: { shared: 'hide' } }] };
  assert.equal(h.buttons(config, extra).length, 1);
  config.contributions = true;
  assert.deepEqual(plain(h.buttons(config, extra)).map(b => b.id), ['other', 'own']);
  assert.equal(h.buttons(config, extra)[1].label, 'Own');
});
test('keyboard button hooks honor enabled conditions and named command aliases', () => {
  const h = harness({ buttons: [{ id: 'x', disabled: true, action: { type: 'command', name: 'tab.new' } }], commands: { toggle: { type: 'toggle-stack', stack: 'center', child: 'browser', fallback: 'main' } } });
  h.tabs.command('button:x', h.cx); assert.equal(h.calls.length, 0);
  h.tabs.command('toggle', h.cx); assert.equal(h.calls[0].args.child, 'browser');
});
test('malformed local storage is harmless and per-space memory restores panels outside render', () => {
  const h = harness(); const key = JSON.stringify(['panel', 'panel-body', 'b']); h.tabs.panels[key] = 'changes';
  h.setSpaces([{ id: 'b', active: true, tabs: [] }]); h.tabs.syncPanel(); assert.equal(h.calls[0].args.child, 'changes');
  h.calls.length = 0; h.tabs.render(h.cx); assert.equal(h.calls.length, 0);
  h.storage.set('panels', '{broken'); h.tabs.init({}, h.cx); assert.equal(typeof h.tabs.panels, 'object');
});
test('tabs select, drag reorder, rename, close, and open context menus', () => {
  const h = harness({ buttons: [] }); let el = h.tabs.render(h.cx);
  h.find(el, 'tab-t1').handlers['on_mouse_down:left']({ click_count: 2 }, h.cx); assert.equal(h.calls.at(-1).name, 'tab.rename');
  h.find(el, 'tab-t2').handlers['on_mouse_up:left']({}, h.cx); assert.equal(h.calls.at(-1).name, 'tab.move');
  h.find(el, 'close-t1').handlers.on_click({}, h.cx); assert.equal(h.calls.at(-1).name, 'tab.close');
  h.find(el, 'tab-t2').handlers['on_mouse_down:left']({}, h.cx); h.find(el, 'tab-t2').handlers['on_mouse_up:left']({}, h.cx); assert.equal(h.calls.at(-1).name, 'tab.select');
  h.find(el, 'tab-t2').handlers['on_mouse_down:right']({}, h.cx); assert.equal(h.calls.at(-1).overlay.mod, 'menu');
});
test('overflow uses this mod and includes hidden-toolbar actions without contributions duplication', () => {
  const h = harness({ maxButtons: 1, buttons: ['a', 'b', 'c'].map(id => ({ id, label: id, action: { type: 'command', name: 'tab.new' } })) });
  const el = h.tabs.render(h.cx); assert.ok(h.find(el, 'action-a')); assert.equal(h.find(el, 'action-b'), undefined);
  h.find(el, 'actions-more').handlers.on_click({}, h.cx);
  const popup = h.calls.at(-1).overlay; assert.equal(popup.mod, 'better-tabs'); assert.deepEqual(plain(popup.props.buttons).map(b => b.id), ['b', 'c']); assert.equal(popup.props.contributions, false);
});
test('overflow action closes itself and dispatches the action', () => {
  const h = harness({ mode: 'overflow', overlay: 'overlay1', buttons: [{ id: 'new', action: { type: 'command', name: 'tab.new' } }] });
  h.find(h.tabs.render(h.cx), 'action-new').handlers.on_click({}, h.cx);
  assert.equal(h.calls[0].close, 'overlay1'); assert.equal(h.calls[1].name, 'tab.new');
});
test('errors become notifications and shipped package has no Factory dependency', () => {
  const h = harness(); h.tabs.act({ type: 'unknown' }, h.cx); assert.match(h.calls[0].notify.body, /Unknown/);
  for (const name of ['main.js', 'actions.js', 'hooks.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /factory-tabs|pull-requests|workflow/);
  for (const asset of ['close', 'spinner', 'file', 'changes', 'win-min', 'win-max', 'win-restore', 'win-close']) assert.ok(fs.existsSync(path.join(root, asset + '.svg')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mod.json'))).place, 'none');
});
