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
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'Hands');
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/bridge.m', 'helper/bridge.h', 'helper/hands_test.go', 'helper/install/main.go', 'README.md', 'RECIPE.md', 'SKILL.md', '.gitignore'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'helper/go.mod'), 'utf8'), /require/);
});

// A minimal stand-in for Herdr's runtime, enough to render the pane and click its button.
const PAST = [
  { file: '/tmp/my demo.mov', started: new Date(Date.now() - 7200000).toISOString(), ended: new Date(Date.now() - 7125000).toISOString(), app: 'Safari', window: 'Docs', note: 'The login flow', seconds: 75, bytes: 2097152 },
  { file: '/tmp/old.mov', started: new Date(Date.now() - 172800000).toISOString(), seconds: 9, bytes: 0, missing: true },
];
const ACTIONS = [
  { time: new Date(Date.now() - 180000).toISOString(), action: 'shot', app: 'Safari', target: 'Docs', file: '/tmp/a b.png' },
  { time: new Date(Date.now() - 240000).toISOString(), action: 'shot', app: 'Safari', file: '/tmp/gone.png', missing: true },
  { time: new Date(Date.now() - 300000).toISOString(), action: 'click', app: 'Safari', by: 'trailhead / Codex', target: 'Button "Save"' },
  { time: new Date(Date.now() - 360000).toISOString(), action: 'key', app: 'Safari', target: 'cmd+s', error: 'Safari is not running' },
  { time: new Date(Date.now() - 7180000).toISOString(), action: 'click', app: 'Safari', target: 'Button "Sign in"' },
  { time: new Date(Date.now() - 7170000).toISOString(), action: 'click', app: 'Finder', target: 'Row "Other app"' },
  { time: new Date(Date.now() - 7126000).toISOString(), action: 'record', app: 'Safari', target: 'The login flow', file: '/tmp/my demo.mov' },
];
function harness(state = { accessibility: false, screen: false }) {
  const pending = [], calls = [], opened = [];
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn(fn) { pending.push(fn(cx)); }, timer: { every() {}, after() {} }, stop_propagation() {} };
  function el() {
    const data = { nodes: [], handlers: {} }; let proxy;
    proxy = new Proxy(data, { get(t, k) { if (k in t) return t[k]; if (k === 'child') return c => { t.nodes.push(c); return proxy; }; if (k === 'children') return c => { t.nodes.push(...c); return proxy; }; if (k === 'when') return (b, f) => { if (b) f(proxy); return proxy; }; return (...a) => { if (k === 'id') t.elementId = a[0]; if (k === 'on_click') t.handlers.click = a[0]; if (k === 'on_open_change') t.handlers.open = a[0]; if (k === 'trigger' || k === 'content') t.nodes.push(a[0]); return proxy; }; } });
    return proxy;
  }
  const context = { Popover: { new: (id) => el().id(id) }, View: class {}, div: el, v_flex: el, h_flex: el, svg: el, appHome: () => '/app', theme: () => ({}), settings: () => ({ font_size: 14 }), readTextFile: async () => null,
    exec: async (bin, args) => {
      if (bin === 'open') { opened.push(args.join(' ')); return { code: 0, stdout: '' }; }
      calls.push(args);
      if (args[0] === 'permissions') {
        const ask = args.find(a => a.startsWith('--ask='))?.slice(6);
        if (ask && state.grants !== false) state[ask] = true;
        return { code: 0, stdout: JSON.stringify(state) };
      }
      if (args[0] === 'actions') return { code: 0, stdout: JSON.stringify(ACTIONS) };
      return { code: 0, stdout: JSON.stringify(args[1] === 'list' ? PAST : { running: true, file: '/tmp/demo.mov' }) };
    } };
  vm.createContext(context);
  const read = (file) => fs.readFileSync(path.join(runtime, file), 'utf8').replace(/^import\s+[\s\S]*?;\n/gm, '');
  const plain = (file) => read(file).replace(/^export /gm, '');
  const source = ['settings.js', 'views/ui.js', 'views/days.js', 'views/permissions.js', 'views/recordings.js', 'views/actions.js'].map(plain).join('\n')
    + read('main.js').replace('export default class Hands', 'globalThis.Mod = class Hands');
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

test('captures list screenshots and recordings together; a recording opens to a summary, and link to their movie', async () => {
  const h = harness({ accessibility: true, screen: true }); await h.flush();
  let tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-permissions'), undefined);
  assert.match(strings(find(tree, 'hands-recording')), /Recording \/tmp\/demo.mov/);
  assert.match(strings(find(tree, 'hands-tab-captures')), /Captures 4/, 'two screenshots and two recordings');
  assert.match(strings(find(tree, 'hands-recording-/tmp/my demo.mov')), /The login flow[\s\S]*Safari, Docs · 2h ago[\s\S]*1m 15s/);
  assert.match(strings(find(tree, 'hands-recording-/tmp/old.mov')), /Whole screen[\s\S]*movie is gone/);
  find(tree, 'hands-recording-/tmp/my demo.mov').handlers.click({}, h.cx);
  tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-detail')), /The login flow[\s\S]*Safari, Docs[\s\S]*Files[\s\S]*my demo\.mov[\s\S]*2\.0 MB/);
  const movie = find(tree, 'hands-movie');
  movie.handlers.click({ modifiers: {} }, h.cx); await h.flush();
  assert.equal(h.opened.length, 0, 'a plain click opens nothing');
  movie.handlers.click({ modifiers: { platform: true } }, h.cx); await h.flush();
  assert.equal(h.opened[0], '/tmp/my demo.mov');
  find(tree, 'hands-movie-reveal').handlers.click({}, h.cx); await h.flush();
  assert.equal(h.opened[1], '-R /tmp/my demo.mov');
  const during = strings(find(tree, 'hands-files'));
  assert.match(during, /Actions 1[\s\S]*Click Button "Sign in"/);
  assert.doesNotMatch(during, /Other app/, 'another app stays out of a window recording');
  assert.doesNotMatch(during, /Record /, 'nor the recording itself');
  find(tree, 'hands-back').handlers.click({}, h.cx);
  assert.ok(find(h.mod.render(h.cx), 'hands-captures'));
  h.mod.selected = '/tmp/old.mov';
  tree = h.mod.render(h.cx);
  assert.equal(find(tree, 'hands-movie'), undefined); assert.match(strings(find(tree, 'hands-detail')), /Gone from \/tmp\/old.mov/);
});

test('actions list what hands did, and their files open on Cmd-click or reveal in Finder', async () => {
  const h = harness({ accessibility: true, screen: true }); await h.flush();
  find(h.mod.render(h.cx), 'hands-tab-actions').handlers.click({}, h.cx);
  const tree = h.mod.render(h.cx);
  const id = (a) => `hands-action-${a.time}-${a.action}-${a.file ?? a.target}`;
  const [saved, gone, click] = ACTIONS;
  assert.match(strings(find(tree, 'hands-tab-actions')), /Actions 7/);
  assert.match(strings(find(tree, 'hands-actions')), /Today \d/);
  assert.match(strings(find(tree, id(click))), /Click Button "Save"[\s\S]*5m ago · Safari · trailhead \/ Codex/);
  assert.equal(find(tree, id(click)).handlers.click, undefined, 'nothing to open');
  assert.match(strings(find(tree, id(saved))), /Screenshot Docs[\s\S]*a b\.png[\s\S]*3m ago · Safari/);
  find(tree, id(saved)).handlers.click({ modifiers: {} }, h.cx); await h.flush();
  assert.equal(h.opened.length, 0, 'a plain click opens nothing');
  find(tree, id(saved)).handlers.click({ modifiers: { platform: true } }, h.cx); await h.flush();
  find(tree, `${id(saved)}-reveal`).handlers.click({}, h.cx); await h.flush();
  assert.deepEqual(h.opened, ['/tmp/a b.png', '-R /tmp/a b.png']);
  assert.equal(find(tree, id(gone)).handlers.click, undefined, 'a gone file has no link');
  assert.equal(find(tree, `${id(gone)}-reveal`), undefined, 'nor a button');
  assert.match(strings(find(tree, id(gone))), /gone\.png is gone/);
  const failed = find(tree, id(ACTIONS[3]));
  assert.match(strings(failed), /Press cmd\+s[\s\S]*Safari is not running/);
  assert.equal(failed.handlers.click, undefined);
  find(tree, 'hands-actions-day-Today').handlers.click({}, h.cx);
  assert.equal(find(h.mod.render(h.cx), id(click)), undefined, 'a folded day hides its rows');
});

test('actions filter by kind or failure, offering only what happened', async () => {
  const h = harness({ accessibility: true, screen: true }); await h.flush();
  assert.equal(find(h.mod.render(h.cx), 'hands-action-filter'), undefined, 'captures have no filter');
  find(h.mod.render(h.cx), 'hands-tab-actions').handlers.click({}, h.cx);
  find(h.mod.render(h.cx), 'hands-filter').handlers.open(true, h.cx);
  let tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-filter-menu')), /All actions \(7\) Failed \(1\)\s+Click \(3\) Press \(1\) Screenshot \(2\) Record \(1\)/);
  assert.equal(find(tree, 'hands-filter-option-scroll'), undefined, 'nothing scrolled');
  find(tree, 'hands-filter-option-click').handlers.click({}, h.cx);
  tree = h.mod.render(h.cx);
  assert.match(strings(find(tree, 'hands-actions')), /Click Button "Save"/);
  assert.doesNotMatch(strings(find(tree, 'hands-actions')), /Screenshot|Press/);
  assert.match(strings(find(tree, 'hands-filter')), /Click/);
  h.mod.filter = 'failed';
  assert.match(strings(find(h.mod.render(h.cx), 'hands-actions')), /Press cmd\+s/);
  h.mod.filter = 'scroll';
  assert.match(strings(find(h.mod.render(h.cx), 'hands-actions')), /No actions match this filter/);
});
