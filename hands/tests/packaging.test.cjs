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
function harness() {
  const pending = [], calls = [];
  const cx = { notify() {}, spawn(fn) { pending.push(fn(cx)); }, timer: { every() {} } };
  function el() {
    const data = { nodes: [], handlers: {} }; let proxy;
    proxy = new Proxy(data, { get(t, k) { if (k in t) return t[k]; if (k === 'child') return c => { t.nodes.push(c); return proxy; }; if (k === 'when') return (b, f) => { if (b) f(proxy); return proxy; }; return (...a) => { if (k === 'id') t.elementId = a[0]; if (k === 'on_click') t.handlers.click = a[0]; return proxy; }; } });
    return proxy;
  }
  const context = { View: class {}, div: el, v_flex: el, h_flex: el, appHome: () => '/app', theme: () => ({}), settings: () => ({ font_size: 14 }), readTextFile: async () => null,
    exec: async (bin, args) => { calls.push(args); return { code: 0, stdout: JSON.stringify(args[0] === 'permissions' ? { accessibility: args.includes('--ask'), screen: true } : { running: true, file: '/tmp/demo.mov' }) }; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(runtime, 'settings.js'), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export async function', 'async function'), context);
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8').replace(/^import\s+[\s\S]*?;\n/gm, '').replace('export default class Hands', 'globalThis.Mod = class Hands');
  vm.runInContext(source, context);
  const mod = new context.Mod(); mod.init({}, cx);
  return { mod, cx, calls, flush: async () => { while (pending.length) await Promise.all(pending.splice(0)); } };
}
const find = (node, id) => node?.elementId === id ? node : node?.nodes?.map(n => find(n, id)).find(Boolean);
const strings = node => typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' ');

test('pane reads permissions and recording state, and the button asks for access', async () => {
  const h = harness(); await h.flush();
  assert.equal(String(h.calls[0]), 'permissions,--json'); assert.equal(String(h.calls[1]), 'record,status,--json');
  let tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-accessibility')), /missing/); assert.match(strings(find(tree, 'hands-screen')), /granted/);
  assert.match(strings(find(tree, 'hands-recording')), /Recording \/tmp\/demo.mov/);
  find(tree, 'hands-ask').handlers.click({}, h.cx); await h.flush();
  assert.equal(String(h.calls[2]), 'permissions,--ask,--json');
  tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-accessibility')), /granted/); assert.equal(find(tree, 'hands-ask'), undefined);
});
