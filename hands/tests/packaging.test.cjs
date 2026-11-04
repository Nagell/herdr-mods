const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/hands');

test('package owns its helper and depends on no other mod', () => {
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /better-tabs|git-pr|peekaboo|mcp/i);
  assert.match(source, /appHome\(\)\}\/mods\/hands\/bin\/hands/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'hands');
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/bridge.m', 'helper/bridge.h', 'helper/hands_test.go', 'install.py', 'README.md', 'RECIPE.md', 'SKILL.md', '.gitignore'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'helper/go.mod'), 'utf8'), /require/);
});

// A minimal stand-in for Herdr's runtime, enough to render the pane and click its button.
const PAST = [
  { file: '/tmp/my demo.mov', started: new Date(Date.now() - 7200000).toISOString(), app: 'Safari', window: 'Docs', note: 'The login flow', seconds: 75, bytes: 2097152 },
  { file: '/tmp/old.mov', started: new Date(Date.now() - 172800000).toISOString(), seconds: 9, bytes: 0, missing: true },
];
function harness(state = { accessibility: false, screen: false }) {
  const pending = [], calls = [], opened = [];
  const cx = { notify() {}, spawn(fn) { pending.push(fn(cx)); }, timer: { every() {} } };
  function el() {
    const data = { nodes: [], handlers: {} }; let proxy;
    proxy = new Proxy(data, { get(t, k) { if (k in t) return t[k]; if (k === 'child') return c => { t.nodes.push(c); return proxy; }; if (k === 'when') return (b, f) => { if (b) f(proxy); return proxy; }; return (...a) => { if (k === 'id') t.elementId = a[0]; if (k === 'on_click') t.handlers.click = a[0]; return proxy; }; } });
    return proxy;
  }
  const context = { View: class {}, div: el, v_flex: el, h_flex: el, svg: el, appHome: () => '/app', theme: () => ({}), settings: () => ({ font_size: 14 }), readTextFile: async () => null,
    exec: async (bin, args) => {
      if (bin === 'open') { opened.push(args[0]); return { code: 0, stdout: '' }; }
      calls.push(args);
      if (args[0] === 'permissions') {
        const ask = args.find(a => a.startsWith('--ask='))?.slice(6);
        if (ask && state.grants !== false) state[ask] = true;
        return { code: 0, stdout: JSON.stringify(state) };
      }
      return { code: 0, stdout: JSON.stringify(args[1] === 'list' ? PAST : { running: true, file: '/tmp/demo.mov' }) };
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(runtime, 'settings.js'), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export async function', 'async function'), context);
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8').replace(/^import\s+[\s\S]*?;\n/gm, '').replace('export default class Hands', 'globalThis.Mod = class Hands');
  vm.runInContext(source, context);
  const mod = new context.Mod(); mod.init({}, cx);
  return { mod, cx, calls, opened, flush: async () => { while (pending.length) await Promise.all(pending.splice(0)); } };
}
const find = (node, id) => node?.elementId === id ? node : node?.nodes?.map(n => find(n, id)).find(Boolean);
const strings = node => typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' ');

test('each permission has its own button and the block leaves once both are granted', async () => {
  const h = harness(); await h.flush();
  find(h.mod.render(h.cx), 'hands-ask-screen').handlers.click({}, h.cx); await h.flush();
  assert.ok(h.calls.some(c => String(c) === 'permissions,--ask=screen,--json'));
  let tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-ask-screen'), undefined); assert.match(strings(find(tree, 'hands-screen')), /Granted/);
  find(tree, 'hands-ask-accessibility').handlers.click({}, h.cx); await h.flush();
  assert.equal(find(h.mod.render(h.cx), 'hands-permissions'), undefined);
  assert.equal(h.opened.length, 0, 'a prompt that worked needs no System Settings');
});

test('a permission the prompt did not grant opens its place in System Settings', async () => {
  const h = harness({ accessibility: false, screen: true, grants: false }); await h.flush();
  const tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-ask-screen'), undefined);
  find(tree, 'hands-ask-accessibility').handlers.click({}, h.cx); await h.flush();
  assert.match(h.opened[0], /Privacy_Accessibility$/);
  assert.ok(find(h.mod.render(h.cx), 'hands-ask-accessibility'), 'still asks until it is granted');
});

test('past recordings list, open to a summary, and link to their movie', async () => {
  const h = harness({ accessibility: true, screen: true }); await h.flush();
  let tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-permissions'), undefined);
  assert.match(strings(find(tree, 'hands-recording')), /Recording \/tmp\/demo.mov/);
  assert.match(strings(find(tree, 'hands-recording-/tmp/my demo.mov')), /The login flow[\s\S]*Safari, Docs · 2h ago · 1m 15s/);
  assert.match(strings(find(tree, 'hands-recording-/tmp/old.mov')), /Whole screen[\s\S]*movie is gone/);
  find(tree, 'hands-recording-/tmp/my demo.mov').handlers.click({}, h.cx);
  tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-detail')), /Summary[\s\S]*The login flow[\s\S]*Safari, Docs[\s\S]*1m 15s[\s\S]*2\.0 MB/);
  const movie = find(tree, 'hands-movie');
  assert.match(strings(movie), /^file:\/\/\/tmp\/my%20demo\.mov$/);
  movie.handlers.click({ modifiers: { platform: true } }, h.cx); await h.flush();
  assert.equal(h.opened[0], '/tmp/my demo.mov');
  find(tree, 'hands-back').handlers.click({}, h.cx);
  assert.ok(find(h.mod.render(h.cx), 'hands-recordings'));
  h.mod.selected = '/tmp/old.mov';
  tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-movie'), undefined); assert.match(strings(find(tree, 'hands-detail')), /Gone from \/tmp\/old.mov/);
});
