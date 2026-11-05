// The panel against stand-ins for Herdr. Nothing here starts an agent or opens an app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../mods/better-files');
const FILES = ['settings.js', 'files/model.js', 'views/ui.js', 'files/reads.js', 'actions/open.js', 'actions/outside.js', 'actions/agents.js', 'actions/menus.js', 'views/tree.js', 'views/viewer.js', 'views/context-menu.js', 'main.js'];
const source = FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n')
  .replace(/^import\s+[\s\S]*?;$/gm, '')
  .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
  .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { parseStatus, parseHunks, lineHeight, viewable, languageOf, sortEntries, MAX_CHARS });';

const TREE = { '/repo': [['d', 'src'], ['f', 'b.md'], ['f', 'a.md']], '/repo/src': [['f', 'main.go']] };

function world({ diff = '', layout = {}, mode = 'sidebar', viewer, file, target, tree = TREE, status = ' M b.md\0M  src/main.go\0?? new.txt\0', editors = ['dev.zed.Zed'], top = '/repo', machine = null, cwd = '/repo', texts = {}, agents = [], known = [], sharedInit = {}, hcResult } = {}) {
  const store = new Map(Object.entries(sharedInit));
  const ran = [], execs = [], sent = [], clipboard = [], closed = [], overlays = [];
  const live = { layout, panes: [{ pane: 'p1', tab: 'tab1', cwd }], focused: { space: 's', tab: 'tab1', pane: 'p1', cwd }, agents, texts: { ...texts } };
  const timers = [];
  const pending = [];
  const cx = {
    focus_handle: () => ({ focus() {} }), stop_propagation() {}, notify() {},
    spawn(fn) { const p = fn(cx); pending.push(p); return p; },
    timer: { every: (_ms, fn) => timers.push(fn), after() {} },
    write_to_clipboard: (text) => clipboard.push(text),
  };
  function el() {
    const data = { nodes: [], handlers: {}, colors: [] };
    const proxy = new Proxy(data, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'child' || k === 'trigger' || k === 'content') return (c) => { t.nodes.push(c); return proxy; };
        if (k === 'children') return (c) => { t.nodes.push(...c); return proxy; };
        if (k === 'when') return (b, f) => { if (b) f(proxy); return proxy; };
        return (...a) => {
          if (k === 'id') t.elementId = a[0];
          if (k === 'text_color') t.colors.push(a[0]);
          if (k === 'on_click') t.handlers.click = a[0];
          if (k === 'on_open_change') t.handlers.open = a[0];
          if (k === 'on_mouse_down') t.handlers[`down-${a[0]}`] = a[1];
          return proxy;
        };
      },
    });
    return proxy;
  }
  const state = (o = {}) => ({ text: o.value ?? '', opts: o, sets: 0, value() { return this.text; }, set_value(v) { this.text = v; this.sets++; }, on() {}, focus() {}, release() { this.released = true; } });
  const context = {
    View: class {}, div: el, svg: el, h_flex: el, v_flex: el,
    Popover: { new: (id) => el().id(id) }, Textarea: { new: () => el() }, TextareaState: { new: state },
    Editor: { new: (s) => el().child(s.text) }, EditorState: { new: (o) => { const s = state(o); context.lastCode = s; return s; } },
    theme: () => new Proxy({}, { get: (_t, k) => `#${String(k)}` }),
    settings: () => ({ font_family: 'Code', font_size: 14 }), window: () => ({ platform: 'macos' }),
    props: () => ({ mode, viewer, file, target, space: 's', overlay: 'ov1' }),
    spaces: () => [{ id: 's', active: true, folder: '/repo', machine, tabs: [{ id: 'tab1' }] }],
    panes: () => live.panes, focused: () => live.focused, agents: () => live.agents,
    shared: (k) => store.get(k), setShared: (k, v) => { store.set(k, v); return null; },
    run: (name, args) => {
      ran.push([name, JSON.parse(JSON.stringify(args))]);
      if (name === 'tab.new' && args.mod) live.panes.push({ pane: `p${live.panes.length + 1}`, tab: `tab${live.panes.length + 1}`, mod: args.mod });
    },
    openOverlay: (spec) => { overlays.push(JSON.parse(JSON.stringify(spec))); return 'ov1'; }, closeOverlay: (id) => closed.push(id),
    layout: () => live.layout, appHome: () => '/app', nextCommand: () => new Promise(() => {}), watchFolder: () => new Promise(() => {}),
    readTextFile: async (p) => { if (p.endsWith('better-changes/mod.json')) return '{}'; if (p.endsWith('better-files/mod.json')) return null; if (live.texts[p] instanceof Error) throw live.texts[p]; return live.texts[p] ?? null; },
    knownAgents: async () => known,
    hc: async (args) => { sent.push(args); return hcResult ?? { code: 0, stdout: '', stderr: '' }; },
    exec: async (bin, args, options) => {
      execs.push([bin, ...args]);
      if (bin === 'sh') return { code: 0, stdout: (tree[args.at(-1)] ?? []).flatMap(([k, n]) => [k, n, '']).join('\0').replace(/\0\0/g, '\0') };
      if (bin === 'mdfind') return { code: 0, stdout: editors.some((b) => args[0].includes(b)) ? '/Apps/It.app\n' : '' };
      if (bin === 'git' && args[0] === 'rev-parse') return top ? { code: 0, stdout: `${top}\n` } : { code: 128, stdout: '' };
      if (bin === 'git' && args.includes('diff')) return { code: 0, stdout: diff };
      if (bin === 'git') return { code: 0, stdout: status };
      return { code: 0, stdout: '', stderr: '' };
    },
    localStorage: { getItem: () => null, setItem() {} }, console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const mod = new context.Mod();
  mod.init({}, cx);
  const flush = async () => { for (let i = 0; i < 25; i++) await new Promise(setImmediate); };
  return { mod, cx, store, ran, execs, sent, clipboard, closed, overlays, live, context, flush, tick: () => { for (const fn of timers) fn(cx); } };
}
const ready = async (o) => { const h = world(o); await h.flush(); return h; };
const find = (node, id) => (node?.elementId === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const strings = (node) => (typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' '));
const click = (h, id, event = { click_count: 1 }) => { const node = find(h.mod.render(), id); assert.ok(node, `no ${id}`); assert.ok(node.handlers.click, `${id} isn't clickable`); node.handlers.click(event, h.cx); };
const tabs = (h) => h.ran.filter(([n]) => n === 'tab.new');
const viewers = (h) => Object.values(h.store.get('better-files.viewers') ?? {});
const AGENT = (address, over = {}) => ({ address, space: 's', tab_name: `Agent ${address}`, status: 'idle', program: { key: 'claude' }, ...over });
const CLAUDE = { key: 'claude', name: 'Claude Code', run: ['claude'], installed: true };

test('the tree lists folders first, opens lazily and marks what changed', async () => {
  const h = await ready();
  const list = strings(find(h.mod.render(), 'files-list'));
  assert.match(list, /src[\s\S]*a\.md[\s\S]*b\.md M/);
  assert.equal(find(h.mod.render(), 'files-row-src/main.go'), undefined);
  click(h, 'files-row-src');
  await h.flush();
  assert.match(strings(find(h.mod.render(), 'files-row-src/main.go')), /main\.go M/);
  click(h, 'files-row-src');
  assert.equal(find(h.mod.render(), 'files-row-src/main.go'), undefined);
});

test('a changed file and a folder holding one are coloured by what happened', async () => {
  const h = await ready();
  const color = (id) => { const seen = []; const walk = (n) => { if (n?.colors) seen.push(...n.colors); (n?.nodes ?? []).forEach(walk); }; walk(find(h.mod.render(), id)); return seen; };
  assert.ok(color('files-row-b.md').includes('#ansi3'), 'edited');
  assert.ok(!color('files-row-a.md').includes('#ansi3'), 'unchanged stays plain');
  assert.ok(color('files-row-src').includes('#ansi3'), 'a folder holding a change');
  const added = await ready({ status: '?? a.md\0D  b.md\0' });
  const of = (id) => { const seen = []; const walk = (n) => { if (n?.colors) seen.push(...n.colors); (n?.nodes ?? []).forEach(walk); }; walk(find(added.mod.render(), id)); return seen; };
  assert.ok(of('files-row-a.md').includes('#ansi2'), 'new');
  assert.ok(of('files-row-b.md').includes('#ansi1'), 'gone');
});

test('the title names the folder in a badge, and there is no Changed tab', async () => {
  const h = await ready({ cwd: '/work/trailhead', tree: { '/work/trailhead': [] } });
  assert.match(strings(find(h.mod.render(), 'files-title')), /Files\s+trailhead/);
  assert.equal(find(h.mod.render(), 'files-tab-changed'), undefined);
  const long = await ready({ cwd: `/work/${'x'.repeat(40)}`, tree: {} });
  assert.match(strings(find(long.mod.render(), 'files-title')), /x{28}…/);
});

test('a click uses one shared tab; a double-click keeps it, and the next click starts another', async () => {
  const h = await ready();
  click(h, 'files-row-a.md');
  assert.equal(tabs(h).length, 1);
  const [, args] = tabs(h)[0];
  assert.equal(args.mod, 'better-files');
  assert.equal(args.name, 'a.md');
  assert.equal(args.props.mode, 'viewer');
  viewers(h); // the new tab's viewer claims it as it opens
  const id = args.props.viewer;
  h.mod.setViewer(id, { tab: 'tab2' });
  click(h, 'files-row-b.md');
  assert.equal(tabs(h).length, 1, 'the same tab shows the next file');
  assert.deepEqual(h.ran.filter(([n]) => n === 'tab.rename').at(-1)[1], { id: 'tab2', name: 'b.md' });
  assert.equal(viewers(h)[0].file.path, '/repo/b.md');
  click(h, 'files-row-b.md', { click_count: 2 });
  assert.equal(viewers(h)[0].preview, false);
  assert.equal(tabs(h).length, 1, 'keeping never opens a second tab');
  click(h, 'files-row-a.md');
  assert.equal(tabs(h).length, 2, 'the kept tab keeps its file');
  assert.equal(viewers(h)[0].file.path, '/repo/b.md');
});

test('a file already open goes to its tab, and rapid clicks never open two', async () => {
  const h = await ready();
  click(h, 'files-row-a.md');
  click(h, 'files-row-b.md');
  assert.equal(tabs(h).length, 1, 'still opening: the pick just changes');
  assert.equal(viewers(h)[0].file.path, '/repo/b.md');
  h.mod.setViewer(tabs(h)[0][1].props.viewer, { tab: 'tab2' });
  click(h, 'files-row-b.md');
  assert.deepEqual(h.ran.at(-1), ['tab.select', { id: 'tab2' }]);
  assert.equal(h.ran.filter(([n]) => n === 'tab.rename').length, 0);
});

test('after a restart, a file open in a tab that came back goes to that tab', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const h = await ready({ sharedInit: { 'better-files.viewers': { v: { space: 's', tab: 'tab7', file, preview: false } } } });
  h.tick();
  h.live.panes.push({ pane: 'p7', tab: 'tab7', mod: 'better-files' });
  click(h, 'files-row-a.md');
  assert.equal(tabs(h).length, 0);
  assert.deepEqual(h.ran.at(-1), ['tab.select', { id: 'tab7' }]);
});

test('a viewer records its own tab, and closed tabs leave the registry', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const h = world({ mode: 'viewer', viewer: 'v1', file, texts: { '/repo/a.md': 'hello' }, sharedInit: { 'better-files.viewers': { v1: { space: 's', file, preview: true, tab: null, at: Date.now() } } } });
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  h.tick();
  await h.flush();
  assert.equal(viewers(h)[0].tab, 'tab2');
  const side = await ready({ sharedInit: { 'better-files.viewers': { gone: { space: 's', tab: 'closed', file } } } });
  side.tick();
  assert.equal(viewers(side).length, 1, 'just started: tabs may still be coming back');
  side.mod.startedAt = 0;
  side.tick();
  assert.equal(viewers(side).length, 0);
  const other = world({ mode: 'viewer', viewer: 'v2', file, sharedInit: { 'better-files.viewers': { v1: { space: 's', tab: 'tab2', file }, v2: { space: 's', tab: null, file, at: Date.now() } } } });
  other.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  other.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  other.tick();
  assert.equal(other.store.get('better-files.viewers').v2.tab, null, 'never takes another viewer\'s tab');
});

test('a new viewer never claims a tab that was already open, such as the one it was opened from', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const h = world({ mode: 'viewer', viewer: 'v', file, sharedInit: { 'better-files.viewers': { v: { space: 's', file, tab: null, others: ['tab1'], at: Date.now() } } } });
  h.live.panes[0] = { pane: 'p1', tab: 'tab1', mod: 'better-files' };
  h.tick();
  assert.equal(h.store.get('better-files.viewers').v.tab, null);
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  h.tick();
  assert.equal(h.store.get('better-files.viewers').v.tab, 'tab2');
});

test('the viewer is read-only, follows the file, and only touches the view on a real change', async () => {
  const file = { path: '/repo/src/main.go', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v1', file, texts: { '/repo/src/main.go': 'one' } });
  const code = h.context.lastCode;
  assert.equal(code.opts.readonly, true);
  assert.equal(code.opts.font_size, 14, 'the terminals\' size');
  assert.equal(code.opts.language, 'go');
  assert.match(strings(h.mod.render()), /main\.go[\s\S]*src[\s\S]*one/);
  h.mod.readFile(h.cx); await h.flush();
  assert.equal(code.sets, 0, 'same text: the place you are reading stays put');
  h.live.texts['/repo/src/main.go'] = 'two';
  h.mod.readFile(h.cx); await h.flush();
  assert.equal(code.text, 'two');
  assert.equal(h.context.lastCode, code, 'the same view');
  h.live.texts['/repo/src/main.go'] = null;
  h.mod.readFile(h.cx); await h.flush();
  assert.match(strings(h.mod.render()), /no longer available/);
});

test('binary, large and unreadable files say what is going on', async () => {
  const file = { path: '/repo/x', root: '/repo', on: null };
  const binary = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': 'a\0b' } });
  assert.match(strings(binary.mod.render()), /binary file/);
  const failing = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': new Error('too big') } });
  assert.match(strings(failing.mod.render()), /can't be shown/);
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': 'y'.repeat(400001) } });
  assert.match(h.context.lastCode.text, /file truncated/);
});

test('the viewer can keep its tab and open in an editor found here, and offers none elsewhere', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const zed = [{ name: 'Zed', bundle: 'dev.zed.Zed' }];
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/a.md': 'x' }, sharedInit: { 'better-files.editors': zed, 'better-files.viewers': { v: { file, preview: true, tab: 't', space: 's' } } } });
  click(h, 'viewer-keep');
  assert.equal(viewers(h)[0].preview, false);
  assert.equal(find(h.mod.render(), 'viewer-keep'), undefined);
  find(h.mod.render(), 'viewer-open-in').handlers.open(true, h.cx);
  click(h, 'viewer-open-in-option-dev.zed.Zed');
  await h.flush();
  assert.deepEqual(h.execs.find(([b]) => b === 'open'), ['open', '-b', 'dev.zed.Zed', '/repo/a.md']);
  const far = await ready({ mode: 'viewer', viewer: 'v', file: { ...file, on: 'box' }, texts: { '/repo/a.md': 'x' }, sharedInit: { 'better-files.editors': zed } });
  assert.equal(find(far.mod.render(), 'viewer-open-in'), undefined);
});

test('there is one title: the pane header with Better Changes\' header, else the file\'s own row', async () => {
  const file = { path: '/repo/src/main.go', root: '/repo', on: null };
  const entry = { v: { space: 's', file, preview: true, tab: 'tab2' } };
  const header = { content: { pane: { header: { content: { mod: 'better-changes' } } } } };
  const h = await ready({ layout: header, mode: 'viewer', viewer: 'v', file, texts: { '/repo/src/main.go': 'x' }, sharedInit: { 'better-files.viewers': entry, 'better-files.editors': [{ name: 'Zed', bundle: 'dev.zed.Zed' }] } });
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  h.tick();
  const head = h.store.get('pane-heads').p2;
  assert.equal(head.title, 'main.go');
  assert.equal(head.detail, 'src · Preview');
  assert.equal(head.icon, 'mods/better-files/icons/file.svg');
  const tree = h.mod.render();
  assert.equal(find(tree, 'viewer-bar'), undefined, 'no second title');
  assert.ok(find(tree, 'viewer-keep'));
  assert.ok(find(tree, 'viewer-open-in'));
  click(h, 'viewer-keep');
  h.tick();
  assert.equal(h.store.get('pane-heads').p2.detail, 'src');
  const own = await ready({ layout: { content: { pane: { header: { content: { mod: 'pane' } } } } }, mode: 'viewer', viewer: 'v', file, texts: { '/repo/src/main.go': 'x' } });
  assert.match(strings(find(own.mod.render(), 'viewer-bar')), /main\.go[\s\S]*src/);
});

test('git diff becomes gutter marks by the file\'s lines as they are now', async () => {
  const { context: m } = await ready();
  const hunks = m.parseHunks('@@ -0,0 +1,2 @@\n+a\n+b\n@@ -5 +7 @@\n-x\n+y\n@@ -9,3 +11,2 @@ func\n@@ -20,2 +18,0 @@\n-z\n-w\n');
  assert.deepEqual(JSON.parse(JSON.stringify(hunks)), [
    { line: 0, count: 2, kind: 'added' },
    { line: 6, count: 1, kind: 'changed' },
    { line: 10, count: 2, kind: 'changed' },
    { line: 18, count: 0, kind: 'removed' },
  ]);
  assert.equal(m.lineHeight(), Math.round(14 * 2 * 1.618034) / 2, 'whole device pixels');
});

const gutterFile = { path: '/repo/b.md', root: '/repo', on: null };
const markBars = (h) => { const out = []; const walk = (n) => { if (n?.elementId?.startsWith?.('viewer-mark-')) out.push(n.elementId); (n?.nodes ?? []).forEach(walk); }; walk(h.mod.render()); return out; };

test('a changed file shows marks, an untracked one is all new, and a clean one has none', async () => {
  const opts = { mode: 'viewer', viewer: 'v', file: gutterFile, texts: { '/repo/b.md': 'one\ntwo\nthree' } };
  const changed = await ready({ ...opts, status: ' M b.md\n', diff: '@@ -1 +1 @@\n-x\n+one\n@@ -3,0 +4,1 @@\n+z\n' });
  assert.equal(markBars(changed).length, 2);
  assert.ok(find(changed.mod.render(), 'viewer-scroll'), 'one box scrolls the file and marks together');
  assert.equal(changed.context.lastCode.opts.folding, false, 'a fold would pull the marks out of line');
  const fresh = await ready({ ...opts, status: '?? b.md\n' });
  assert.equal(JSON.stringify(fresh.mod.hunks), JSON.stringify([{ line: 0, count: null, kind: 'added' }]));
  assert.equal(markBars(fresh).length, 1);
  const clean = await ready({ ...opts, status: '' });
  assert.equal(markBars(clean).length, 0);
  assert.ok(!clean.execs.some((e) => e.includes('diff')), 'nothing changed: no diff to read');
  changed.mod.readHunks(changed.cx);
  await changed.flush();
  assert.equal(markBars(changed).length, 2, 'unchanged marks stay');
  const args = changed.execs.find((e) => e.includes('diff'));
  for (const flag of ['--no-ext-diff', '--no-textconv', '-U0']) assert.ok(args.includes(flag), flag);
});

test('the gutter can be turned off, which brings folding back', async () => {
  const h = await ready({ mode: 'viewer', viewer: 'v', file: gutterFile, texts: { '/repo/b.md': 'x', '/app/mods/better-files/mod.json': null }, status: ' M b.md\n', diff: '@@ -1 +1 @@\n' });
  assert.equal(h.mod.gutterOn, true);
  h.mod.gutterOn = false;
  h.mod.code = null; h.mod.text = undefined; h.mod.hunks = [];
  h.mod.readFile(h.cx);
  await h.flush();
  assert.equal(h.context.lastCode.opts.folding, true);
  assert.equal(find(h.mod.render(), 'viewer-scroll'), undefined);
  assert.equal(markBars(h).length, 0);
});

test('only editors that are installed are found', async () => {
  const h = await ready({ editors: ['dev.zed.Zed'] });
  assert.deepEqual([...h.store.get('better-files.editors').map((e) => e.name)], ['Zed']);
});

const FILE_TARGET = { path: '/repo/b.md', root: '/repo', on: null, top: '/repo', dir: false, relative: 'b.md', changed: true, staged: false };
const menuOf = (o) => ready({ mode: 'menu', target: FILE_TARGET, ...o });
const labels = (h) => strings(find(h.mod.render(), 'files-menu'));

test('right-click opens a menu at the pointer for that row', async () => {
  const h = await ready();
  find(h.mod.render(), 'files-row-b.md').handlers['down-right']({}, h.cx);
  const spec = h.overlays[0];
  assert.equal(spec.kind, 'popup');
  assert.equal(spec.mod, 'better-files');
  assert.equal(spec.props.target.path, '/repo/b.md');
  assert.equal(spec.props.target.changed, true);
  assert.equal(spec.props.target.relative, 'b.md');
});

test('a file\'s menu opens, copies, reveals and shows a diff, then closes', async () => {
  const shared_ = { 'better-files.editors': [{ name: 'Zed', bundle: 'dev.zed.Zed' }], 'better-files.has-changes': true };
  const h = await menuOf({ sharedInit: shared_ });
  assert.match(labels(h), /Open[\s\S]*Open in new tab[\s\S]*Open in Zed[\s\S]*Open in default app[\s\S]*Show in Finder[\s\S]*Show diff[\s\S]*Copy relative path[\s\S]*Copy full path/);
  click(h, 'files-menu-copy-relative');
  click(h, 'files-menu-copy-path');
  assert.deepEqual(h.clipboard, ['b.md', '/repo/b.md']);
  assert.equal(h.closed.length, 2);
  click(h, 'files-menu-reveal');
  click(h, 'files-menu-default');
  click(h, 'files-menu-editor-dev.zed.Zed');
  await h.flush();
  assert.deepEqual(h.execs.filter(([b]) => b === 'open'), [['open', '-R', '/repo/b.md'], ['open', '/repo/b.md'], ['open', '-b', 'dev.zed.Zed', '/repo/b.md']]);
  click(h, 'files-menu-open-tab');
  assert.equal(tabs(h).at(-1)[1].props.mode, 'viewer');
  assert.equal(viewers(h)[0].preview, false, 'a tab of its own');
});

test('Show diff hands the file to Better Changes the way its own list does', async () => {
  const h = await menuOf({ sharedInit: { 'better-files.has-changes': true }, target: { ...FILE_TARGET, path: '/repo/src/main.go', root: '/repo/src', relative: 'src/main.go', staged: true } });
  click(h, 'files-menu-diff');
  const [, args] = tabs(h)[0];
  assert.equal(args.mod, 'better-changes');
  assert.equal(args.props.mode, 'diff');
  assert.equal(args.props.selection.path, 'src/main.go', 'by path from the Git root');
  assert.equal(args.props.selection.scope, 'staged');
  assert.equal(args.props.selection.context, JSON.stringify({ cwd: '/repo', on: null }));
  assert.equal(h.store.get('better-changes.diff-tabs').s.selection.path, 'src/main.go');
});

test('what does not apply is not offered', async () => {
  const unchanged = await menuOf({ target: { ...FILE_TARGET, changed: false }, sharedInit: { 'better-files.has-changes': true } });
  assert.doesNotMatch(labels(unchanged), /Show diff/);
  const noChanges = await menuOf({ sharedInit: { 'better-files.has-changes': false } });
  assert.doesNotMatch(labels(noChanges), /Show diff/);
  const folder = await menuOf({ target: { ...FILE_TARGET, dir: true, changed: false }, sharedInit: { 'better-files.editors': [{ name: 'Zed', bundle: 'dev.zed.Zed' }] } });
  assert.doesNotMatch(labels(folder), /Open in new tab|default app|Show diff/);
  assert.match(labels(folder), /Open in Zed[\s\S]*Show in Finder[\s\S]*Copy/);
  const far = await menuOf({ target: { ...FILE_TARGET, on: 'box' }, sharedInit: { 'better-files.editors': [{ name: 'Zed', bundle: 'dev.zed.Zed' }] } });
  assert.doesNotMatch(labels(far), /Zed|Finder|default app/);
  assert.match(labels(far), /Copy full path/);
});

test('sending to an agent asks for a prompt, then sends the path and not the file', async () => {
  const known = [CLAUDE];
  const h = await ready({ agents: [AGENT('t1')], known });
  const menu = await menuOf({ agents: [AGENT('t1')], sharedInit: { 'better-files.new-agents': [{ key: 'claude', name: 'Claude Code', run: ['claude'] }] } });
  assert.match(labels(menu), /Send to Agent t1[\s\S]*Send to Agent t1 \(spawn\)[\s\S]*Send to new Claude Code/);
  click(menu, 'files-menu-agent-t1');
  const asked = menu.store.get('better-files.compose');
  assert.equal(asked.address, 't1');
  h.store.set('better-files.compose', asked);
  h.tick();
  assert.match(strings(find(h.mod.render(), 'files-composer')), /Send to Agent t1[\s\S]*b\.md/);
  assert.equal(find(h.mod.render(), 'files-prompt-send').handlers.click, undefined, 'a prompt is required');
  h.mod.editor.set_value('Summarise this');
  click(h, 'files-prompt-send');
  await h.flush();
  assert.deepEqual([...h.sent[0]], ['send', 't1', 'Summarise this\n\nFile: /repo/b.md']);
  assert.equal(h.mod.composer, null);
  assert.equal(h.mod.notice, 'Sent to Agent t1.');
});

test('(spawn) starts a sub-agent with no shell, and a new agent gets its own tab', async () => {
  const h = await ready({ agents: [AGENT('t1', { status: 'working' })], known: [CLAUDE] });
  h.store.set('better-files.compose', { at: 1, target: FILE_TARGET, address: 'spawn:t1' });
  h.tick();
  assert.match(strings(find(h.mod.render(), 'files-composer')), /Send to Agent t1 \(spawn\)/);
  h.mod.editor.set_value('Do it');
  click(h, 'files-prompt-send');
  await h.flush();
  assert.deepEqual([...h.sent[0]], ['run', '--bg', '--json', '--parent', 't1', '--cwd', '/repo', 'claude', 'Do it\n\nFile: /repo/b.md']);
  assert.equal(h.mod.notice, 'Started a sub-agent under Agent t1.');
  h.store.set('better-files.compose', { at: 2, target: FILE_TARGET, address: 'new:claude' });
  h.tick();
  h.mod.editor.set_value('Do it');
  click(h, 'files-prompt-send');
  await h.flush();
  assert.deepEqual(h.ran.at(-1), ['tab.new', { folder: '/repo', argv: ['claude'], task: 'Do it\n\nFile: /repo/b.md' }]);
  assert.equal(h.sent.length, 1);
});

test('a failed delivery keeps what was typed and says why', async () => {
  const h = await ready({ agents: [AGENT('t1')], hcResult: { code: 1, stderr: 'gone' } });
  h.store.set('better-files.compose', { at: 1, target: FILE_TARGET, address: 't1' });
  h.tick();
  h.mod.editor.set_value('Keep me');
  click(h, 'files-prompt-send');
  await h.flush();
  assert.match(strings(h.mod.render()), /gone/);
  assert.ok(h.mod.composer);
  assert.equal(h.mod.editor.value(), 'Keep me');
});

test('looking at a file tab leaves the tree where it was', async () => {
  const h = await ready({ cwd: '/repo/src' });
  assert.equal(h.mod.root, '/repo/src');
  h.live.panes.push({ pane: 'p9', tab: 'tab9', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab9', pane: 'p9' };
  h.tick();
  assert.equal(h.mod.root, '/repo/src');
});

test('moving to another folder loads it even while the last one is still loading', async () => {
  const h = world({ cwd: '/repo' });
  h.live.panes[0].cwd = '/repo/src';
  h.live.focused.cwd = '/repo/src';
  h.tick();
  await h.flush();
  assert.equal(h.mod.root, '/repo/src');
  assert.equal(h.mod.loading, null);
  assert.match(strings(find(h.mod.render(), 'files-list')), /main\.go/);
});

test('the status parser and helpers', async () => {
  const { context: m } = await ready();
  const marks = m.parseStatus(' M a\0M  b\0?? c\0D  d\0UU e\0', '/r');
  assert.deepEqual(JSON.parse(JSON.stringify(marks)), {
    '/r/a': { mark: 'M', staged: false }, '/r/b': { mark: 'M', staged: true }, '/r/c': { mark: 'A', staged: false },
    '/r/d': { mark: 'D', staged: true }, '/r/e': { mark: 'U', staged: false },
  });
  assert.equal(m.languageOf('a/b.tsx'), 'js');
  assert.equal(m.languageOf('Makefile'), 'txt');
});

test('every icon is used, every used icon exists, and nothing here can write a file', () => {
  const code = FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const icons = fs.readdirSync(path.join(root, 'icons')).map((f) => f.replace('.svg', ''));
  for (const icon of icons) assert.ok(code.includes(`"${icon}"`), `unused icon ${icon}`);
  for (const [, name] of code.matchAll(/(?:icon: |Icon\()"([a-z-]+)"/g)) assert.ok(icons.includes(name), `missing icon ${name}`);
  assert.doesNotMatch(code, /writeTextFile|writeFile|\brm\b|readonly: false/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mod.json'))).title, 'Better Files');
  assert.doesNotMatch(code, /panel-body|better-tabs|estro/i);
});
