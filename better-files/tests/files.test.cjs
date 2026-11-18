// The panel against stand-ins for Herdr. Nothing here starts an agent or opens an app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../mods/better-files');
const FILES = ['settings.js', 'files/model.js', 'files/file-icons.js', 'files/filter.js', 'views/ui.js', 'files/reads.js', 'actions/open.js', 'actions/outside.js', 'actions/agents.js', 'actions/menus.js', 'views/tree.js', 'views/filter.js', 'views/tools.js', 'views/keys.js', 'views/viewer.js', 'views/context-menu.js', 'main.js'];
// syntax.js keeps a scope of its own, as a module does: its languageOf isn't model.js's.
const lexer = fs.readFileSync(path.join(root, 'syntax.js'), 'utf8').replace(/^export /gm, '');
const source = `const { highlightLines, tokenizeLine, syntaxColors, languageOf: lexerLanguage, WHOLE_FILE_LINES, fenceLanguage } = (() => {\n${lexer}\nreturn { highlightLines, tokenizeLine, syntaxColors, languageOf, WHOLE_FILE_LINES, fenceLanguage };\n})();\n`
  + FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n')
    .replace(/^import\s+[\s\S]*?;$/gm, '')
    .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
    .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { parseStatus, parseHunks, buildRows, highlightLines, tokenizeLine, lexerLanguage, viewable, languageOf, sortEntries, markdownBlocks, resolvePath, isMarkdown, MAX_CHARS, indexOf, findMatches, matchRows, foldersTo, MAX_INDEXED, MAX_MATCHES, COPY_IMAGE });';

const TREE = { '/repo': [['d', 'src'], ['f', 'b.md'], ['f', 'a.md']], '/repo/src': [['f', 'main.go']] };

// Every file under /repo, as git ls-files -z would list it.
const EVERY = 'a.md\0b.md\0new.txt\0src/main.go\0';

function world({ pictures = {}, spaceFolder = '/repo', focusOn = null, storage = {}, everything = EVERY, deleted = '', found = '', copyImage, diff = '', layout = {}, mode = 'sidebar', viewer, file, target, tree = TREE, status = ' M b.md\0M  src/main.go\0?? new.txt\0', editors = ['dev.zed.Zed'], top = '/repo', machine = null, cwd = '/repo', texts = {}, agents = [], known = [], sharedInit = {}, hcResult } = {}) {
  const store = new Map(Object.entries(sharedInit));
  const ran = [], execs = [], sent = [], clipboard = [], closed = [], overlays = [], urls = [], scrolled = [];
  const live = { pictures: { ...pictures }, layout, panes: [{ pane: 'p1', tab: 'tab1', cwd }, ...(focusOn ? [focusOn] : [])], focused: focusOn ? { space: 's', tab: focusOn.tab, pane: focusOn.pane, cwd: null } : { space: 's', tab: 'tab1', pane: 'p1', cwd }, agents, texts: { ...texts } };
  const timers = [], later = [];
  const kept = new Map(Object.entries(storage));
  const waiting = [];
  // What holds the keyboard: a focus handle or an input's state.
  let holder = null;
  const take = (next) => {
    if (holder === next) return;
    const last = holder;
    holder = next;
    last?.handlers?.blur?.({}, cx);
    next?.handlers?.focus?.({}, cx);
  };
  const pending = [];
  const cx = {
    focus_handle: () => { const handle = { focus: () => take(handle), is_focused: () => holder === handle }; return handle; }, stop_propagation() {}, notify() { cx.notified = (cx.notified ?? 0) + 1; },
    spawn(fn) { const p = fn(cx); pending.push(p); return p; },
    timer: { every: (_ms, fn) => timers.push(fn), after: (ms, fn) => later.push([ms, fn]) },
    write_to_clipboard: (text) => clipboard.push(text),
    open_url: (url) => urls.push(url),
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
          if (k === 'border_color') t.border = a[0];
          if (k === 'on_click') t.handlers.click = a[0];
          if (k === 'on_item_click') t.handlers.item = a[0];
          if (k === 'on_link_click') t.handlers.link = a[0];
          if (k === 'on_open_change') t.handlers.open = a[0];
          if (k === 'on_mouse_down') t.handlers[`down-${a[0]}`] = a[1];
          if (k === 'on_key_down') t.handlers.key = a[0];
          return proxy;
        };
      },
    });
    return proxy;
  }
  const state = (o = {}) => ({ text: o.value ?? '', opts: o, sets: 0, handlers: {}, value() { return this.text; }, set_value(v) { this.text = v; this.sets++; this.handlers.change?.({}, cx); }, on(ev, fn) { this.handlers[ev] = fn; }, focus() { take(this); }, get focused() { return holder === this; }, release() { this.released = true; } });
  const context = {
    View: class {}, div: el, svg: (p) => { const e = el(); e.svgPath = p; e.child(`svg:${p}`); return e; }, image: (p) => { const e = el(); e.child(`image:${p}`); return e; }, h_flex: el, v_flex: el,
    Popover: { new: (id) => el().id(id) }, Textarea: { new: () => el() }, TextareaState: { new: state }, Input: { new: () => el() }, InputState: { new: state }, ScrollHandle: { new: () => ({ scroll_to_item: (i) => scrolled.push(i) }) },
    Scrollbar: { vertical: () => el() }, TextView: { markdown: (id, text) => el().id(id).child(`md:${text}`) }, v_virtual_list: (_id, count, sizes, key, render) => { const e = el().id('viewer-list'); if (Array.isArray(sizes) && sizes.length !== count) throw new Error('sizes'); for (let i = 0; i < count; i++) key(i); e.children(render({ start: 0, end: Math.min(count, 60) })); return e; }, Editor: { new: (s) => el().child(s.text) }, EditorState: { new: (o) => { const s = state(o); context.lastCode = s; return s; } },
    theme: () => new Proxy({}, { get: (_t, k) => `#${String(k)}` }),
    settings: () => ({ font_family: 'Code', font_size: 14 }), window: () => ({ platform: 'macos' }),
    props: () => ({ mode, viewer, file, target, space: 's', overlay: 'ov1' }),
    // Space `s` is the active one; a pane with `space` set puts its tab in that space instead.
    // A focused file tab (`focusOn`) is its space's shown tab.
    spaces: () => {
      const tabsOf = (id) => live.panes.filter((p) => (p.space ?? 's') === id).map((p) => p.tab);
      const ids = [...new Set(['s', ...live.panes.map((p) => p.space ?? 's')])];
      return ids.map((id) => ({ id, active: id === 's', folder: spaceFolder, machine, tabs: [...new Set(id === 's' ? ['tab1', ...tabsOf(id)] : tabsOf(id))].map((tab) => ({ id: tab, ...(focusOn && tab === focusOn.tab ? { active: true } : {}) })) }));
    },
    panes: () => live.panes, focused: () => live.focused, agents: () => live.agents,
    shared: (k) => store.get(k), setShared: (k, v) => { store.set(k, v); return null; },
    run: (name, args) => {
      ran.push([name, JSON.parse(JSON.stringify(args))]);
      if (name === 'tab.new' && args.mod) live.panes.push({ pane: `p${live.panes.length + 1}`, tab: `tab${live.panes.length + 1}`, mod: args.mod });
    },
    openOverlay: (spec) => { overlays.push(JSON.parse(JSON.stringify(spec))); return 'ov1'; }, closeOverlay: (id) => closed.push(id),
    layout: () => live.layout, appHome: () => '/app', nextCommand: () => new Promise((resolve) => waiting.push(resolve)), watchFolder: () => new Promise(() => {}),
    readTextFile: async (p) => { if (p.endsWith('better-changes/mod.json')) return '{}'; if (p.endsWith('better-files/mod.json')) return null; if (live.texts[p] instanceof Error) throw live.texts[p]; return live.texts[p] ?? null; },
    knownAgents: async () => known,
    hc: async (args) => { sent.push(args); return hcResult ?? { code: 0, stdout: '', stderr: '' }; },
    exec: async (bin, args, options) => {
      execs.push([bin, ...args]);
      if (bin === 'sh' && args[2] === 'copy-image') return (typeof copyImage === 'function' ? copyImage(args) : copyImage) ?? { code: 0, stdout: `${args[5]}-${live.pictures[args[3]] ?? '111-3'}.${args[6]}` };
      if (bin === 'sh' && args[2] === 'index') return { code: 0, stdout: found };
      if (bin === 'git' && args.includes('--deleted')) return top ? { code: 0, stdout: deleted } : { code: 128, stdout: '' };
      if (bin === 'git' && args.includes('ls-files')) return top ? { code: 0, stdout: everything } : { code: 128, stdout: '' };
      if (bin === 'sh' && args[2] === 'fetch-image') return { code: 0, stdout: `${args[4]}.svg` };
      if (bin === 'sh') return { code: 0, stdout: (tree[args.at(-1)] ?? []).flatMap(([k, n]) => [k, n, '']).join('\0').replace(/\0\0/g, '\0') };
      if (bin === 'mdfind') return { code: 0, stdout: editors.some((b) => args[0].includes(b)) ? '/Apps/It.app\n' : '' };
      if (bin === 'git' && args[0] === 'rev-parse') return top ? { code: 0, stdout: `${top}\n` } : { code: 128, stdout: '' };
      if (bin === 'git' && args.includes('diff')) return { code: 0, stdout: diff };
      if (bin === 'git') return { code: 0, stdout: status };
      return { code: 0, stdout: '', stderr: '' };
    },
    localStorage: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)) }, console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const mod = new context.Mod();
  mod.init({}, cx);
  const flush = async () => { for (let i = 0; i < 25; i++) await new Promise(setImmediate); };
  const command = async (name) => { for (let i = 0; i < 25 && !waiting.length; i++) await new Promise(setImmediate); waiting.shift()(name); await flush(); };
  return { mod, cx, store, kept, command, ran, execs, sent, clipboard, closed, overlays, urls, scrolled, later, live, context, flush, tick: () => { for (const fn of timers) fn(cx); } };
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

test('a viewer\'s tab is always in its own space, so a click never switches spaces', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  // Focus sits on a Better Files tab in another space while this viewer opens.
  const h = world({ mode: 'viewer', viewer: 'v', file, sharedInit: { 'better-files.viewers': { v: { space: 's', file, tab: null, others: [], at: Date.now() } } } });
  h.live.panes.push({ pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
  h.live.focused = { space: 'other', tab: 'tab9', pane: 'p9' };
  h.tick();
  assert.equal(h.store.get('better-files.viewers').v.tab, null, 'another space\'s tab is not its own');
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  h.tick();
  assert.equal(h.store.get('better-files.viewers').v.tab, 'tab2');

  // An entry recorded wrongly before: its tab lives in another space.
  const side = await ready({ sharedInit: { 'better-files.viewers': { bad: { space: 's', tab: 'tab9', file: { path: '/repo/b.md', root: '/repo', on: null }, preview: true } } } });
  side.live.panes.push({ pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
  click(side, 'files-row-a.md');
  assert.ok(!side.ran.some(([n, a]) => n === 'tab.select' && a.id === 'tab9'), 'never selects the other space\'s tab');
  assert.equal(tabs(side).at(-1)[1].space, 's', 'opens a tab in this space instead');
  side.mod.startedAt = 0;
  side.tick();
  assert.ok('bad' in side.store.get('better-files.viewers'), 'kept while its viewer is open, so it keeps what it shows');
});

test('a viewer holding a tab in another space keeps its file and choices, and claims its own tab, never a newer viewer\'s', async () => {
  const a = { path: '/repo/a.md', root: '/repo', on: null };
  const b = { path: '/repo/b.md', root: '/repo', on: null };
  // Opened with a.md and now showing b.md in code view as the shared tab, its tab tab2,
  // but recorded with tab9 in another space.
  const wrong = { space: 's', tab: 'tab9', file: b, preview: true, markdown: 'code', others: ['tab1'], at: 1 };
  const h = world({ mode: 'viewer', viewer: 'v', file: a, sharedInit: { 'better-files.viewers': { v: wrong } } });
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' }, { pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
  h.tick();
  assert.equal(h.mod.file.path, '/repo/b.md');
  // A newer viewer is opening here; its tab is focused first.
  const viewersNow = () => h.store.get('better-files.viewers');
  h.store.set('better-files.viewers', { ...viewersNow(), n: { space: 's', tab: null, file: a, preview: false, others: ['tab1', 'tab2', 'tab9'], at: Date.now() } });
  h.live.panes.push({ pane: 'p3', tab: 'tab3', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab3', pane: 'p3' };
  h.tick();
  assert.equal(viewersNow().v.tab, 'tab9', 'leaves the newer viewer\'s tab to it');
  // Its own tab is focused.
  h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  h.tick();
  const v = viewersNow().v;
  assert.deepEqual([v.tab, v.file.path, v.preview, v.markdown], ['tab2', '/repo/b.md', true, 'code']);
  assert.equal(h.mod.file.path, '/repo/b.md');
});

test('a viewer with a wrong entry never puts its header on the other space\'s tab', async () => {
  const file = { path: '/repo/b.md', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/b.md': 'hi' }, sharedInit: { 'better-files.viewers': { v: { space: 's', tab: 'tab9', file, preview: true, others: [], at: 1 } } } });
  h.live.panes.push({ pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
  h.tick();
  assert.equal(h.store.get('pane-heads')?.p9, undefined);
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
  h.tick();
  h.tick();
  assert.ok(h.store.get('pane-heads')?.p2, 'its own tab gets it once claimed');
});

test('a tab not listed in any space yet still counts as held, so a viewer keeps it', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const h = world({ mode: 'viewer', viewer: 'v', file, sharedInit: { 'better-files.viewers': { v: { space: 's', tab: 'tab2', file, preview: true, others: [], at: 1 } } } });
  h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' }, { pane: 'p3', tab: 'tab3', mod: 'better-files' });
  h.live.focused = { space: 's', tab: 'tab3', pane: 'p3' };
  // Tabs coming back after a restart: panes know tab2 before the space lists it.
  h.context.spaces = () => [{ id: 's', active: true, folder: '/repo', tabs: [{ id: 'tab1' }, { id: 'tab3' }] }];
  h.tick();
  assert.equal(h.store.get('better-files.viewers').v.tab, 'tab2');
  const side = await ready({ sharedInit: { 'better-files.viewers': { v: { space: 's', tab: 'tab2', file, preview: true } } } });
  side.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' });
  side.context.spaces = () => [{ id: 's', active: true, folder: '/repo', tabs: [{ id: 'tab1' }] }];
  click(side, 'files-row-a.md');
  assert.ok(side.ran.some(([n, a]) => n === 'tab.select' && a.id === 'tab2'), 'a click still reuses it');
  assert.equal(tabs(side).length, 0);
});

test('the newer of two opening viewers claims the newer tab', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const entries = () => ({
    old: { space: 's', tab: null, file, others: ['tab1'], at: Date.now() - 100 },
    n: { space: 's', tab: null, file, others: ['tab1', 'tab2'], at: Date.now() },
  });
  for (const [id, focus, claims] of [['old', 'tab3', null], ['n', 'tab3', 'tab3'], ['old', 'tab2', 'tab2'], ['n', 'tab2', null]]) {
    const h = world({ mode: 'viewer', viewer: id, file, sharedInit: { 'better-files.viewers': entries() } });
    h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' }, { pane: 'p3', tab: 'tab3', mod: 'better-files' });
    h.live.focused = { space: 's', tab: focus, pane: 'p' };
    h.tick();
    assert.equal(h.store.get('better-files.viewers')[id].tab, claims, `${id} with ${focus} focused`);
  }
});

test('a newer viewer only holds an older one back while it is still opening in the same space', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const old = { space: 's', tab: null, file, others: ['tab1'], at: Date.now() - 100 };
  for (const [why, entries] of [
    ['it already has its tab', { old, n: { space: 's', tab: 'tab3', file, others: ['tab1'], at: Date.now() } }],
    ['it opens in another space', { old, n: { space: 'other', tab: null, file, others: [], at: Date.now() } }],
    // Both asked for long ago: the newer one's opening has run out without a tab.
    ['its opening has run out', { old: { ...old, at: 5 }, n: { space: 's', tab: null, file, others: [], at: 10 } }],
  ]) {
    const h = world({ mode: 'viewer', viewer: 'old', file, sharedInit: { 'better-files.viewers': entries } });
    h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' }, { pane: 'p3', tab: 'tab3', mod: 'better-files' });
    h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
    h.tick();
    assert.equal(h.store.get('better-files.viewers').old.tab, 'tab2', `claims its tab when ${why}`);
  }
});

test('a viewer finding its own tab next to a newer shared tab becomes a tab you keep', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const wrong = { space: 's', tab: 'tab9', file, preview: true, others: ['tab1'], at: 1 };
  const shared = { space: 's', tab: 'tab3', file, preview: true, others: ['tab1', 'tab2'], at: Date.now() };
  for (const [entries, preview] of [[{ v: wrong }, true], [{ v: wrong, n: shared }, false]]) {
    const h = world({ mode: 'viewer', viewer: 'v', file, sharedInit: { 'better-files.viewers': entries } });
    h.live.panes.push({ pane: 'p2', tab: 'tab2', mod: 'better-files' }, { pane: 'p3', tab: 'tab3', mod: 'better-files' }, { pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
    h.live.focused = { space: 's', tab: 'tab2', pane: 'p2' };
    h.tick();
    const v = h.store.get('better-files.viewers').v;
    assert.deepEqual([v.tab, v.preview], ['tab2', preview]);
  }
});

test('a tab held by an entry from another space can still be claimed by its own viewer', async () => {
  const file = { path: '/repo/a.md', root: '/repo', on: null };
  const h = world({ mode: 'viewer', viewer: 'r', file, sharedInit: { 'better-files.viewers': {
    bad: { space: 's', tab: 'tab9', file, preview: true, others: [], at: 1 },
    r: { space: 'other', tab: null, file, others: [], at: Date.now() },
  } } });
  h.live.panes.push({ pane: 'p9', tab: 'tab9', mod: 'better-files', space: 'other' });
  h.live.focused = { space: 'other', tab: 'tab9', pane: 'p9' };
  h.tick();
  assert.equal(h.store.get('better-files.viewers').r.tab, 'tab9');
});

test('the viewer follows the file, and keeps the same rows until it really changes', async () => {
  const file = { path: '/repo/src/main.go', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/src/main.go': 'one' } });
  assert.match(strings(h.mod.render()), /main\.go[\s\S]*src[\s\S]*1[\s\S]*one/);
  const first = h.mod.fileLines();
  h.mod.readFile(h.cx); await h.flush();
  assert.equal(h.mod.fileLines(), first, 'same text: nothing is rebuilt');
  h.live.texts['/repo/src/main.go'] = 'two\nthree';
  h.mod.readFile(h.cx); await h.flush();
  assert.match(strings(find(h.mod.render(), 'viewer-lines')), /two[\s\S]*2[\s\S]*three/);
  h.live.texts['/repo/src/main.go'] = null;
  h.mod.readFile(h.cx); await h.flush();
  assert.match(strings(h.mod.render()), /no longer available/);
});

const CHANGES = { mode: 'viewer', viewer: 'v', file: { path: '/repo/b.txt', root: '/repo', on: null }, texts: { '/repo/b.txt': 'a\nb\nc' }, status: ' M b.txt\n', diff: '@@ -1 +1 @@\n-old a\n+a\n@@ -3,2 +1,0 @@\n-gone 1\n-gone 2\n@@ -9,0 +3 @@\n+c\n' };
const clickRow = (h, key) => find(h.mod.render(), 'viewer-list').handlers.item(key, h.cx);

test('rows put each mark with its own line, and a removal gets a thin row of its own', async () => {
  const { context: m } = await ready();
  const rows = (hunks, open = new Set()) => JSON.parse(JSON.stringify(m.buildRows(['a', 'b'], hunks, open).map((r) => r.key)));
  const removed = { line: 1, count: 0, kind: 'removed', oldStart: 4, old: ['x'] };
  assert.deepEqual(rows([removed]), ['line-0', 'removed-1', 'line-1']);
  assert.deepEqual(rows([{ ...removed, line: 9 }]), ['line-0', 'line-1', 'removed-2'], 'past the end is the end');
  const h = await ready(CHANGES);
  const tree = h.mod.render();
  assert.ok(find(find(tree, 'viewer-line-0'), 'viewer-mark-0'), 'the mark is inside its own row');
  assert.ok(find(tree, 'viewer-removed-1'));
  assert.equal(find(find(tree, 'viewer-line-1'), 'viewer-mark-1'), undefined);
  assert.ok(find(find(tree, 'viewer-line-2'), 'viewer-mark-2'));
});

test('clicking a change opens the old lines in place, and clicking again closes it', async () => {
  const h = await ready(CHANGES);
  clickRow(h, 'line-1');
  assert.equal(h.mod.openHunks.size, 0, 'an unchanged line does nothing');
  clickRow(h, 'line-2');
  assert.equal(h.mod.openHunks.size, 0, 'added lines replaced nothing');
  clickRow(h, 'line-0');
  let list = strings(find(h.mod.render(), 'viewer-lines'));
  assert.match(list, /1\s+old a\s+1\s+a/, 'old above new');
  clickRow(h, 'removed-1');
  list = strings(find(h.mod.render(), 'viewer-lines'));
  assert.match(list, /3\s+gone 1\s+4\s+gone 2\s+2\s+b/, 'old numbers, where they were');
  assert.equal(find(h.mod.render(), 'viewer-removed-1'), undefined);
  clickRow(h, 'old-1');
  assert.doesNotMatch(strings(find(h.mod.render(), 'viewer-lines')), /old a/, 'an old line closes it too');
  clickRow(h, 'old-3');
  assert.ok(find(h.mod.render(), 'viewer-removed-1'), 'back to the thin line');
  clickRow(h, 'line-0');
  h.store.set('better-files.viewers', { v: { file: { path: '/repo/a.md', root: '/repo', on: null }, tab: 'tab1' } });
  h.tick();
  assert.equal(h.mod.openHunks.size, 0, 'another file starts closed');
});

test('a line is coloured by what its words are', async () => {
  const { context: m } = await ready();
  const runs = (line, lang) => JSON.parse(JSON.stringify(m.tokenizeLine(line, lang).runs));
  const tokens = (line, lang, state) => JSON.parse(JSON.stringify(m.tokenizeLine(line, lang, state).runs.filter((r) => r.kind).map((r) => [r.text, r.kind])));
  assert.deepEqual(runs('const a = "b"; // "c"', 'js'), [{ text: 'const', kind: 'keyword' }, { text: ' a = ', kind: null }, { text: '"b"', kind: 'string' }, { text: '; ', kind: null }, { text: '// "c"', kind: 'comment' }]);
  assert.deepEqual(runs('x = 12 # note', 'py'), [{ text: 'x = ', kind: null }, { text: '12', kind: 'number' }, { text: ' ', kind: null }, { text: '# note', kind: 'comment' }]);
  assert.deepEqual(runs('"http://x" y', 'js'), [{ text: '"http://x"', kind: 'string' }, { text: ' y', kind: null }], 'no comment inside a string');
  assert.deepEqual(runs("don't return", 'md'), [{ text: "don't return", kind: null }], 'prose is left alone');
  assert.equal(m.tokenizeLine('', 'go').runs.length, 1);
  assert.deepEqual(tokens('export function load(id: string): Promise<User> {', 'ts'), [['export', 'keyword'], ['function', 'keyword'], ['load', 'function'], ['string', 'type'], ['Promise', 'type'], ['User', 'type']]);
  assert.deepEqual(tokens('  const user = await api.fetchUser(id) ?? null; // MAX_SIZE', 'ts'), [['const', 'keyword'], ['await', 'keyword'], ['fetchUser', 'function'], ['null', 'constant'], ['// MAX_SIZE', 'comment']]);
  assert.deepEqual(tokens('@Component({ max: MAX_SIZE, at: new Date(0) })', 'ts'), [['@Component', 'function'], ['MAX_SIZE', 'constant'], ['new', 'keyword'], ['Date', 'type'], ['0', 'number']]);
  assert.deepEqual(tokens('<MyButton :label="title" @click="go(1)" disabled />', 'vue'), [['<MyButton', 'tag'], [':label', 'attribute'], ['"title"', 'string'], ['@click', 'attribute'], ['"go(1)"', 'string'], ['disabled', 'attribute']]);
  const tag = m.tokenizeLine('<input', 'vue');
  assert.deepEqual(tokens('  v-model="x">', 'vue', tag.state), [['v-model', 'attribute'], ['"x"', 'string']], 'a tag carries to the next line');
  assert.deepEqual(tokens('  "name": "herdr",', 'json'), [['"name"', 'property'], ['"herdr"', 'string']]);
  assert.deepEqual(tokens('  "private": true, "n": 1', 'json'), [['"private"', 'property'], ['true', 'constant'], ['"n"', 'property'], ['1', 'number']]);
  assert.deepEqual(tokens('- name: herdr # app', 'yaml'), [['name', 'property'], ['# app', 'comment']]);
});

test('comments, template strings and tags carry from one line to the next', async () => {
  const { context: m } = await ready();
  const tokens = (lines, lang) => JSON.parse(JSON.stringify(m.highlightLines(lines, lang).map((runs) => runs.filter((r) => r.kind).map((r) => [r.text, r.kind]))));
  assert.deepEqual(tokens(['/* one', 'two */ let s = `a', '${b}` + C'], 'ts'), [
    [['/* one', 'comment']],
    [['two */', 'comment'], ['let', 'keyword'], ['`a', 'string']],
    [['${b}`', 'string']],
  ]);
  assert.deepEqual(tokens(['<!-- a', 'b --> <div>'], 'vue'), [[['<!-- a', 'comment']], [['b -->', 'comment'], ['<div', 'tag']]]);
  assert.deepEqual(tokens(['"""Doc', 'more"""', 'x = 1'], 'py'), [[['"""Doc', 'string']], [['more"""', 'string']], [['1', 'number']]]);
});

test('colouring never changes a line\'s text', async () => {
  const { context: m } = await ready();
  const repo = path.join(__dirname, '../..');
  const files = ['better-files', 'better-changes'].flatMap((mod) => [
    ...fs.readdirSync(path.join(repo, mod), { recursive: true }).filter((f) => /\.(js|cjs|md|json|sh)$/.test(f)).map((f) => path.join(repo, mod, f)),
  ]);
  assert.ok(files.length > 20, 'the mods\' own files are read');
  const samples = { 'a.vue': '<template>\n  <a :href="x"\n     @click.prevent="go">{{ y }}</a>\n</template>\n<script setup lang="ts">\nconst y = `${1}\n`\n</script>', 'a.go': 'x := `raw\nstring`\nfmt.Println("a\\"b")', 'a.rs': "let c = 'x'; // it's", 'a.sql': 'SELECT * FROM t -- c\n/* a\n b */', 'a.toml': 'key = "v"\n[table]' };
  const texts = [...files.map((f) => [f, fs.readFileSync(f, 'utf8')]), ...Object.entries(samples)];
  for (const [name, text] of texts) {
    const lines = text.split('\n');
    const joined = JSON.parse(JSON.stringify(m.highlightLines(lines, m.lexerLanguage(name)).map((runs) => runs.map((r) => r.text).join(''))));
    assert.deepEqual(joined, lines, name);
  }
});

test('the row view colours a file from the top, so a comment carries to the next row', async () => {
  const file = { path: '/repo/x.ts', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x.ts': '/* note\nstill note */ const A = 1' } });
  const colorOf = (node, text) => (node?.nodes?.includes(text) ? node.colors.at(-1) : node?.nodes?.map((n) => colorOf(n, text)).find(Boolean));
  const row = find(h.mod.render(), 'viewer-line-1');
  assert.ok(row, 'the second row is drawn');
  assert.equal(colorOf(row, 'still note */'), '#dim', 'still a comment');
  assert.equal(colorOf(row, 'const'), '#ansi5');
});

test('binary, large and unreadable files say what is going on', async () => {
  const file = { path: '/repo/x', root: '/repo', on: null };
  const binary = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': 'a\0b' } });
  assert.match(strings(binary.mod.render()), /binary file/);
  const failing = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': new Error('too big') } });
  assert.match(strings(failing.mod.render()), /can't be shown/);
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/x': 'y'.repeat(400001) } });
  assert.match(strings(h.mod.render()), /file truncated/);
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

test('with Better Icons installed, rows and the title show its icons; without it, the plain ones', async () => {
  const PACK = { '/app/mods/better-icons/icons.json': fs.readFileSync(path.join(__dirname, '../../better-icons/mods/better-icons/icons.json'), 'utf8') };
  const icon = (h, id) => strings(find(h.mod.render(), id).nodes[1]);
  const h = await ready({ texts: PACK });
  assert.equal(icon(h, 'files-row-src'), 'image:mods/better-icons/icons/folder-src.svg');
  assert.equal(icon(h, 'files-row-a.md'), 'image:mods/better-icons/icons/markdown.svg');
  click(h, 'files-row-src');
  await h.flush();
  assert.equal(icon(h, 'files-row-src'), 'image:mods/better-icons/icons/folder-src-open.svg');
  assert.equal(icon(h, 'files-row-src/main.go'), 'image:mods/better-icons/icons/go.svg');
  const plain = await ready();
  assert.equal(icon(plain, 'files-row-src'), 'svg:mods/better-files/icons/folder.svg');
  assert.equal(icon(plain, 'files-row-a.md'), 'svg:mods/better-files/icons/file.svg');
  assert.doesNotMatch(strings(plain.mod.render()), /image:/);
  const file = { path: '/repo/src/main.go', root: '/repo', on: null };
  const bar = (texts) => ready({ layout: { content: { pane: { header: { content: { mod: 'pane' } } } } }, mode: 'viewer', viewer: 'v', file, texts: { '/repo/src/main.go': 'x', ...texts } });
  assert.equal(strings(find((await bar(PACK)).mod.render(), 'viewer-bar').nodes[0]), 'image:mods/better-icons/icons/go.svg');
  assert.equal(strings(find((await bar({})).mod.render(), 'viewer-bar').nodes[0]), 'svg:mods/better-files/icons/file.svg');
  const outside = await ready({ layout: { content: { pane: { header: { content: { mod: 'pane' } } } } }, mode: 'viewer', viewer: 'v', file: { path: '/elsewhere/Dockerfile', root: '/repo/src', on: null }, texts: { '/elsewhere/Dockerfile': 'x', ...PACK } });
  assert.equal(strings(find(outside.mod.render(), 'viewer-bar').nodes[0]), 'image:mods/better-icons/icons/docker.svg');
});

test('git diff becomes changes by the file\'s lines as they are now, with what they replaced', async () => {
  const { context: m } = await ready();
  const hunks = m.parseHunks('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n@@ -5 +7 @@\n-x\n+y\n@@ -9,3 +11,2 @@ func\n-p\n-- q\n-r\n+s\n+t\n@@ -20,2 +18,0 @@\n-z\n-w\n\\\\ No newline at end of file\n');
  assert.deepEqual(JSON.parse(JSON.stringify(hunks)), [
    { line: 0, count: 2, kind: 'added', oldStart: 0, old: [] },
    { line: 6, count: 1, kind: 'changed', oldStart: 5, old: ['x'] },
    { line: 10, count: 2, kind: 'changed', oldStart: 9, old: ['p', '- q', 'r'] },
    { line: 18, count: 0, kind: 'removed', oldStart: 20, old: ['z', 'w'] },
  ]);
});

const gutterFile = { path: '/repo/b.txt', root: '/repo', on: null };
const markBars = (h) => { const out = []; const walk = (n) => { if (n?.elementId?.startsWith?.('viewer-mark-')) out.push(n.elementId); (n?.nodes ?? []).forEach(walk); }; walk(h.mod.render()); return out; };

test('a changed file shows marks, an untracked one is all new, and a clean one has none', async () => {
  const opts = { mode: 'viewer', viewer: 'v', file: gutterFile, texts: { '/repo/b.txt': 'one\ntwo\nthree\nfour' } };
  const changed = await ready({ ...opts, status: ' M b.txt\n', diff: '@@ -1 +1 @@\n-x\n+one\n@@ -3,0 +4,1 @@\n+z\n' });
  assert.equal(markBars(changed).length, 2);
  const fresh = await ready({ ...opts, status: '?? b.txt\n' });
  assert.equal(JSON.stringify(fresh.mod.hunks), JSON.stringify([{ line: 0, count: null, kind: 'added', oldStart: 0, old: [] }]));
  assert.equal(markBars(fresh).length, 4, 'every line is new');
  const clean = await ready({ ...opts, status: '' });
  assert.equal(markBars(clean).length, 0);
  assert.ok(!clean.execs.some((e) => e.includes('diff')), 'nothing changed: no diff to read');
  changed.mod.readHunks(changed.cx);
  await changed.flush();
  assert.equal(markBars(changed).length, 2, 'unchanged marks stay');
  const args = changed.execs.find((e) => e.includes('diff'));
  for (const flag of ['--no-ext-diff', '--no-textconv', '-U0']) assert.ok(args.includes(flag), flag);
});

test('the setting can use Herdr\'s own editor instead', async () => {
  const h = await ready({ mode: 'viewer', viewer: 'v', file: gutterFile, texts: { '/repo/b.txt': 'x', '/app/mods/better-files/mod.json': null }, status: ' M b.txt\n', diff: '@@ -1 +1 @@\n' });
  assert.equal(h.mod.gutterOn, true);
  h.mod.gutterOn = false;
  h.mod.code = null; h.mod.text = undefined; h.mod.hunks = [];
  h.mod.readFile(h.cx);
  await h.flush();
  assert.equal(h.context.lastCode.opts.readonly, true);
  assert.equal(h.context.lastCode.opts.language, 'txt');
  assert.deepEqual(Object.keys(h.context.lastCode.opts.syntax).sort(), ['boolean', 'comment', 'constant', 'function', 'keyword', 'number', 'operator', 'string', 'string.escape', 'type']);
  assert.equal(find(h.mod.render(), 'viewer-lines'), undefined);
  assert.equal(markBars(h).length, 0);
});

test('an image shows as a picture, with no text read and no gutter', async () => {
  const file = { path: '/repo/shot.PNG', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, status: ' M shot.PNG\n', diff: '@@ -1 +1 @@\n' });
  assert.match(strings(find(h.mod.render(), 'viewer-image')), /^image:mods\/better-files\/\.cache\/v-111-3\.png$/);
  assert.equal(h.context.lastCode, undefined);
  const copy = h.execs.find((e) => e[1] === '-c' && e[3] === 'copy-image');
  assert.deepEqual(JSON.parse(JSON.stringify(copy.slice(4))), ['/repo/shot.PNG', '/app/mods/better-files/.cache', 'v', 'png', ''], 'names go as arguments');
  h.store.set('better-files.viewers', { v: { file: { ...file, path: '/repo/other.jpg' }, tab: 'tab1' } });
  h.tick();
  await h.flush();
  assert.match(strings(find(h.mod.render(), 'viewer-image')), /^image:mods\/better-files\/\.cache\/v-111-3\.jpg$/, 'a new file, a new name');
  assert.equal(h.execs.filter((e) => e[3] === 'copy-image').at(-1)[8], '/app/mods/better-files/.cache/v-111-3.png', 'the old copy goes');
  await h.mod.close();
  assert.deepEqual(JSON.parse(JSON.stringify(h.execs.at(-1))), ['rm', '-f', '--', '/app/mods/better-files/.cache/v-111-3.jpg']);
  const gone = await ready({ mode: 'viewer', viewer: 'v', file, copyImage: { code: 1 } });
  assert.match(strings(gone.mod.render()), /no longer available/);
  assert.equal(markBars(h).length, 0);
  assert.ok(!h.execs.some((e) => e.includes('diff')));
  const far = await ready({ mode: 'viewer', viewer: 'v', file: { ...file, on: 'box' } });
  assert.match(strings(far.mod.render()), /another machine/);
  const text = await ready({ mode: 'viewer', viewer: 'v', file: { path: '/repo/png', root: '/repo', on: null }, texts: { '/repo/png': 'x' } });
  assert.equal(find(text.mod.render(), 'viewer-image'), undefined);
});

test('the folder icon opens the whole folder in an editor or Finder, here only', async () => {
  const zed = [{ name: 'Zed', bundle: 'dev.zed.Zed' }];
  const h = await ready({ sharedInit: { 'better-files.editors': zed } });
  find(h.mod.render(), 'files-folder').handlers.open(true, h.cx);
  assert.match(strings(find(h.mod.render(), 'files-folder-menu')), /Open in Zed[\s\S]*Open in Finder/);
  click(h, 'files-folder-option-dev.zed.Zed');
  find(h.mod.render(), 'files-folder').handlers.open(true, h.cx);
  click(h, 'files-folder-option-finder');
  await h.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.execs.filter(([b]) => b === 'open'))), [['open', '-b', 'dev.zed.Zed', '/repo'], ['open', '/repo']]);
  const far = await ready({ machine: 'box', sharedInit: { 'better-files.editors': zed } });
  assert.equal(find(far.mod.render(), 'files-folder'), undefined);
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

test('the suggested key focuses the tree through a command the sidebar handles', () => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, '../keys.json'), 'utf8'));
  assert.deepEqual(keys, { global: { 'cmd-shift-e': 'better-files.focus' } });
  assert.match(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), /command === "focus"\) this\.focusTree\(cx\)/);
});

test('every icon is used, every used icon exists, and nothing here can write a file', () => {
  const code = [...FILES, 'syntax.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const icons = fs.readdirSync(path.join(root, 'icons')).map((f) => f.replace('.svg', ''));
  for (const icon of icons) assert.ok(code.includes(`"${icon}"`), `unused icon ${icon}`);
  for (const [, name] of code.matchAll(/(?:icon: |Icon\()"([a-z-]+)"/g)) assert.ok(icons.includes(name), `missing icon ${name}`);
  assert.doesNotMatch(code, /writeTextFile|writeFile|readonly: false/);
  assert.equal((code.match(/\brm\b/g) ?? []).length, 3, 'rm only ever touches the cache: a replaced copy, a half-made one, and a closing tab\'s');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mod.json'))).title, 'Better Files');
  assert.doesNotMatch(code, /panel-body|better-tabs|estro/i);
});

test('Markdown splits at headings, gives code its own blocks, and pulls out lines of pictures', async () => {
  const { context: m } = await ready();
  const blocks = (text, folder = '/repo/docs') => JSON.parse(JSON.stringify(m.markdownBlocks(text, folder)));
  const elements = [
    'A paragraph with **bold**, *italic*, `code` and [a link](other.md).', '- one\n  - nested\n    1. deeper\n- two',
    '1. first\n2. second', '> quoted\n> more', '| a | b |\n| --- | --- |\n| 1 | 2 |', '---', '<https://example.com>',
  ];
  for (const element of elements) assert.deepEqual(blocks(element), [{ type: 'text', text: element }], element);
  const doc = elements.join('\n\n');
  assert.deepEqual(blocks(doc), [{ type: 'text', text: doc }], 'text with no heading stays one block');
  assert.deepEqual(blocks('Intro\n# About The Project\nText\n## About *The* Project!'), [
    { type: 'text', text: 'Intro' },
    { type: 'text', text: '# About The Project\nText', anchor: 'about-the-project' },
    { type: 'text', text: '## About *The* Project!', anchor: 'about-the-project-1' },
  ], 'each heading starts a block with the anchor GitHub gives it');
  const refs = blocks('See [the docs][d].\n\n# Next\nMore\n\n[d]: https://x.dev');
  assert.equal(refs.length, 2);
  assert.ok(refs.every((b) => b.text.endsWith('[d]: https://x.dev')), 'every piece keeps the reference definitions');

  assert.deepEqual(blocks('```js\nconst x = 1;\n```'), [{ type: 'code', lang: 'js', text: 'const x = 1;' }]);
  assert.deepEqual(blocks('- pnpm\n   ```sh\n   npm install pnpm -g\n   ```'), [
    { type: 'text', text: '- pnpm' },
    { type: 'code', lang: 'sh', text: 'npm install pnpm -g' },
  ], 'a fence in a list item, its indent taken off');
  assert.deepEqual(blocks('~~~~\n```\n![x](a.png)\n~~~~'), [{ type: 'code', lang: '', text: '```\n![x](a.png)' }], 'a picture in a fence is code');

  assert.deepEqual(blocks('Intro\n\n![A shot](../pics/My%20Shot.PNG "title")\n\nAfter'), [
    { type: 'text', text: 'Intro\n' },
    { type: 'image', alt: 'A shot', path: '/repo/pics/My Shot.PNG' },
    { type: 'text', text: '\nAfter' },
  ]);
  assert.deepEqual(blocks('![x](<my pic.jpeg>)\r'), [{ type: 'image', alt: 'x', path: '/repo/docs/my pic.jpeg' }], 'angle brackets and CRLF');
  assert.deepEqual(blocks('![abs](/shots/a.gif)'), [{ type: 'image', alt: 'abs', path: '/shots/a.gif' }]);
  assert.deepEqual(blocks('![web](https://x.dev/a.png)'), [{ type: 'image', alt: 'web', url: 'https://x.dev/a.png' }], 'a picture from the web');

  const badges = [
    '* [![Nuxt][Nuxt.js]][Nuxt-url]', '* [![Vue][Vue.js]][Vue-url]', '',
    '[Nuxt.js]: https://img.shields.io/badge/Nuxt', '[Nuxt-url]: https://nuxt.com',
    '[Vue.js]: https://img.shields.io/badge/Vue', '[Vue-url]: https://vuejs.org',
  ].join('\n');
  assert.deepEqual(blocks(badges), [{
    type: 'images',
    rows: [
      { bullet: true, items: [{ alt: 'Nuxt', url: 'https://img.shields.io/badge/Nuxt', href: 'https://nuxt.com' }] },
      { bullet: true, items: [{ alt: 'Vue', url: 'https://img.shields.io/badge/Vue', href: 'https://vuejs.org' }] },
    ],
  }], 'reference badges in list items, one block of rows');
  assert.deepEqual(blocks('    <img src="images/logo.png" alt="Logo" width="80" height="80">', '/repo'), [{
    type: 'images', rows: [{ bullet: false, items: [{ alt: 'Logo', path: '/repo/images/logo.png', href: null, width: 80, height: 80 }] }],
  }], 'an HTML picture, indented inside a <div>, with its size');
  assert.deepEqual(blocks('<p><a href="https://x.dev"><img src="b.svg"></a> ![c](c.png)</p>', '/repo'), [{
    type: 'images', rows: [{ bullet: false, items: [{ alt: '', path: '/repo/b.svg', href: 'https://x.dev' }, { alt: 'c', path: '/repo/c.png', href: null }] }],
  }], 'pictures side by side, one of them a link');

  for (const stays of ['    ![x](a.png)', '- item\n  ![x](a.png)', 'see ![x](a.png) inline', '![doc](a.pdf)', '> ![x](a.png)', '<div align="center">'])
    assert.ok(blocks(stays).every((b) => b.type === 'text'), `stays text: ${stays}`);
  // A line with anything that can't be drawn as a picture is left whole, so nothing on it is lost.
  for (const whole of ['![a](a.png) ![d](doc.pdf)', '* [![Gone][missing]][u]', '<img src="data:image/png;base64,AAAA"> <img src="a.png">'])
    assert.ok(blocks(whole).every((b) => b.type === 'text'), `stays text: ${whole}`);
  assert.equal(m.headingAnchor('snake_case option'), 'snake_case-option', 'an underscore in a name stays, as on GitHub');
  assert.equal(m.headingAnchor('The _emphasis_ and __init__'), 'the-emphasis-and-init', 'emphasis underscores go');
  assert.equal(blocks('# snake_case option')[0].anchor, 'snake_case-option');
  assert.deepEqual(blocks(''), []);
  assert.deepEqual(blocks('\n\n  \n'), []);
});

test('malformed Markdown never throws', async () => {
  const { context: m } = await ready();
  for (const text of ['```\nnever closed', '![broken](', '![](  )', '[link](', '| a |\n|', '**open', '> > > >', '- \n  -\n    -', '\0\u0001', '%E0%A4%A', '![x](%E0%A4%A.png)', null, undefined, 42, 'a'.repeat(100000)])
    assert.doesNotThrow(() => m.markdownBlocks(text, '/repo'), String(text).slice(0, 20));
  assert.equal(m.resolvePath('/repo', '%E0%A4%A.png'), '/repo/%E0%A4%A.png', 'a bad escape is kept as written');
  assert.equal(m.resolvePath('/repo/docs', '../a.md#part'), '/repo/a.md');
  assert.equal(m.resolvePath('/repo', './b/./c.md?x=1'), '/repo/b/c.md');
  assert.equal(m.resolvePath('/', '../../x'), '/x');
  assert.equal(m.resolvePath('/repo', 'file:///tmp/y.md'), '/tmp/y.md');
  for (const none of ['https://x.dev', 'mailto:a@b.c', '#top', '', null]) assert.equal(m.resolvePath('/repo', none), null, String(none));
  assert.ok(m.isMarkdown('/a/README.MD') && m.isMarkdown('/a/b.markdown') && !m.isMarkdown('/a/md') && !m.isMarkdown('/a/b.mdx'));
});

const MD = { path: '/repo/docs/guide.md', root: '/repo', on: null };
const mdWorld = (o = {}) => ready({ mode: 'viewer', viewer: 'v', file: MD, texts: { '/repo/docs/guide.md': '# Guide\n\nSee [next](next.md).\n\n![Shot](pics/shot.PNG)\n\nEnd' }, ...o });

test('a Markdown file opens in Preview; the toggle switches to Code and back, remembered per tab', async () => {
  const h = await mdWorld();
  const render = () => h.mod.render();
  assert.ok(find(render(), 'viewer-preview'), 'Preview by default');
  assert.match(strings(find(render(), 'viewer-preview')), /md:# Guide/);
  assert.equal(find(render(), 'viewer-lines'), undefined);
  assert.equal(find(render(), 'viewer-show-old'), undefined, 'no Expand all in Preview');
  click(h, 'viewer-view-code');
  assert.equal(h.store.get('better-files.viewers').v.markdown, 'code', 'kept with this tab');
  assert.ok(find(render(), 'viewer-lines'), 'the code view, with its gutter');
  assert.equal(find(render(), 'viewer-preview'), undefined);
  h.mod.markdownDefault = 'preview';
  assert.ok(find(render(), 'viewer-lines'), 'the tab\'s choice beats the default');
  click(h, 'viewer-view-preview');
  assert.ok(find(render(), 'viewer-preview'));
  const other = await mdWorld({ viewer: 'w' });
  other.mod.markdownDefault = 'code';
  assert.ok(find(other.mod.render(), 'viewer-lines'), 'the setting picks the default for a tab with no choice');
  const text = await ready({ mode: 'viewer', viewer: 'v', file: { path: '/repo/a.txt', root: '/repo', on: null }, texts: { '/repo/a.txt': 'x' } });
  assert.equal(find(text.mod.render(), 'viewer-view'), undefined, 'only Markdown has the toggle');
});

test('the preview follows the file on disk, and shows its pictures through the cache', async () => {
  const h = await mdWorld();
  const copy = h.execs.find((e) => e[3] === 'copy-image');
  assert.deepEqual(JSON.parse(JSON.stringify(copy.slice(4))), ['/repo/docs/pics/shot.PNG', '/app/mods/better-files/.cache', 'v-m1', 'png', '']);
  assert.match(strings(h.mod.render()), /image:mods\/better-files\/\.cache\/v-m1-111-3\.png/);
  h.live.texts['/repo/docs/guide.md'] = '# Changed';
  h.tick();
  await h.flush();
  assert.match(strings(find(h.mod.render(), 'viewer-preview')), /md:# Changed/);
  await h.mod.close();
  assert.deepEqual(JSON.parse(JSON.stringify(h.execs.at(-1))), ['rm', '-f', '--', '/app/mods/better-files/.cache/v-m1-111-3.png']);
  const gone = await mdWorld({ copyImage: { code: 1 } });
  assert.match(strings(gone.mod.render()), /Shot isn't available/);
  const far = await mdWorld({ file: { ...MD, on: 'box' } });
  assert.match(strings(far.mod.render()), /another machine/);
});

test('links open on the web, or open a file here in the viewer', async () => {
  const h = await mdWorld();
  const link = find(h.mod.render(), 'viewer-md-v-0').handlers.link;
  link('https://example.com/x', h.cx);
  assert.deepEqual([...h.urls], ['https://example.com/x']);
  link('#section', h.cx);
  link('mailto:a@b.c', h.cx);
  assert.equal(tabs(h).length, 0);
  link('next.md', h.cx);
  const [, args] = tabs(h).at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(args.props.file)), { path: '/repo/docs/next.md', root: '/repo', on: null });
  link('../../elsewhere/x.md', h.cx);
  assert.equal(viewers(h).find((e) => e.file.path === '/elsewhere/x.md').file.root, '/elsewhere', 'outside the root, its own folder');
});

test('the preview draws code blocks, rows of badges from the web, and jumps to an anchor', async () => {
  const readme = [
    '# Title', '', 'See [the project](#about-the-project).', '', '## About The Project', 'Text', '',
    '* [![Nuxt][n]][u]', '', '```sh', 'pnpm dev # start', '```', '',
    '[n]: https://img.shields.io/badge/Nuxt', '[u]: https://nuxt.com',
  ].join('\n');
  const file = { path: '/repo/README.md', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/README.md': readme } });
  const fetch = h.execs.find((e) => e[3] === 'fetch-image');
  assert.equal(fetch[4], 'https://img.shields.io/badge/Nuxt', 'the badge is downloaded');
  assert.match(fetch[5], /^\/app\/mods\/better-files\/\.cache\/web-[0-9a-f]+$/);
  const render = () => h.mod.render();
  const colorOf = (node, s) => (node?.nodes?.includes(s) ? node.colors.at(-1) : node?.nodes?.map((n) => colorOf(n, s)).find(Boolean));

  const code = find(render(), 'viewer-code-3');
  assert.ok(code, 'the fence is a code block');
  assert.match(strings(code), /sh/, 'its language at the top');
  assert.equal(colorOf(code, '# start'), '#dim', 'a comment in it is grey');
  click(h, 'viewer-code-copy-3');
  assert.deepEqual([...h.clipboard], ['pnpm dev # start'], 'the copy button copies the code');

  const badge = find(render(), 'viewer-image-2-0-0');
  assert.match(strings(badge), /image:mods\/better-files\/\.cache\/web-[0-9a-f]+\.svg/);
  click(h, 'viewer-image-2-0-0');
  assert.deepEqual([...h.urls], ['https://nuxt.com'], 'a linked badge opens its link');

  find(render(), 'viewer-md-v-0').handlers.link('#about-the-project', h.cx);
  assert.equal(h.scrolled.at(-1), 1, 'the anchor scrolls to its heading\'s block');

  await h.mod.close();
  assert.ok(!h.execs.some((e) => e[0] === 'rm' && e.some((a) => /web-/.test(a))), 'closing keeps the shared downloads');
});

const typeFilter = async (h, text) => { h.mod.filter.set_value(text); await h.flush(); };
const rowIds = (h) => (find(h.mod.render(), 'files-list').nodes ?? []).map((n) => n.elementId).filter((id) => typeof id === 'string');

test('the filter index lists every file once, with the folders they are in', async () => {
  const { context: m } = await ready();
  const index = m.indexOf('./src/a.ts\0src/a.ts\0docs/guide/intro.md\0README.md\0');
  assert.deepEqual([...index.files], ['src/a.ts', 'docs/guide/intro.md', 'README.md']);
  assert.deepEqual([...index.dirs].sort(), ['docs', 'docs/guide', 'src']);
  assert.equal(index.capped, false);
  const cut = m.indexOf('one.md\0two.md\0thr');
  assert.deepEqual([...cut.files], ['one.md', 'two.md'], 'a name cut short is dropped');
  assert.equal(cut.capped, true);
  const many = m.indexOf(Array.from({ length: m.MAX_INDEXED + 5 }, (_, i) => `f${i}`).join('\0') + '\0');
  assert.equal(many.files.length, m.MAX_INDEXED);
  assert.equal(many.capped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(m.indexOf(''))), { files: [], dirs: [], capped: false });
});

test('a name holding the words matches, names that start with them first; a / matches the path', async () => {
  const { context: m } = await ready();
  const index = m.indexOf('src/button.tsx\0src/icons/play-button.svg\0docs/buttons.md\0ui/mybutton.md\0tests/a.spec.ts\0Makefile\0');
  const paths = (q) => [...m.findMatches(index, q).hits.map((h) => h.path)];
  assert.deepEqual(paths('BUTTON'), ['src/button.tsx', 'docs/buttons.md', 'ui/mybutton.md', 'src/icons/play-button.svg']);
  assert.deepEqual(paths('icons'), ['src/icons']);
  assert.deepEqual(JSON.parse(JSON.stringify(m.findMatches(index, 'icons').hits[0])), { path: 'src/icons', dir: true });
  assert.deepEqual(paths('src/b'), ['src/button.tsx']);
  assert.deepEqual(paths('nothing here'), []);
  assert.deepEqual(paths('   '), []);
  const big = m.indexOf(Array.from({ length: 250 }, (_, i) => `f${i}.md`).join('\0') + '\0');
  const found = m.findMatches(big, '.md');
  assert.equal(found.hits.length, m.MAX_MATCHES);
  assert.equal(found.more, true);
});

test('matches show as a tree under their folders, folders first, and a folder reveals all the way down', async () => {
  const { context: m } = await ready();
  const rows = m.matchRows([{ path: 'src/ui/button.tsx', dir: false }, { path: 'docs', dir: true }, { path: 'a-button.md', dir: false }]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { relative: 'docs', name: 'docs', dir: true, depth: 0, hit: true, open: false },
    { relative: 'src', name: 'src', dir: true, depth: 0, hit: false, open: true },
    { relative: 'src/ui', name: 'ui', dir: true, depth: 1, hit: false, open: true },
    { relative: 'src/ui/button.tsx', name: 'button.tsx', dir: false, depth: 2, hit: true, open: false },
    { relative: 'a-button.md', name: 'a-button.md', dir: false, depth: 0, hit: true, open: false },
  ]);
  assert.deepEqual([...m.foldersTo('a/b/c', true)], ['a', 'a/b', 'a/b/c']);
  assert.deepEqual([...m.foldersTo('a/b/c.md', false)], ['a', 'a/b']);
});

test('the filter finds a file in a folder not opened yet, from Git\'s list, and Enter opens it', async () => {
  const h = await ready();
  assert.ok(find(h.mod.render(), 'files-filter-input'), 'the filter sits under the header');
  assert.equal(find(h.mod.render(), 'files-filter-clear'), undefined, 'no clear button while empty');
  await typeFilter(h, 'main');
  assert.equal(h.execs.filter((e) => e.includes('--cached')).length, 1);
  assert.equal(h.execs.filter((e) => e[0] === 'sh' && e[3] === 'index').length, 0, 'no find inside a repo');
  assert.deepEqual(rowIds(h), ['files-row-src', 'files-row-src/main.go']);
  assert.match(strings(find(h.mod.render(), 'files-row-src/main.go')), /main\.go M/);
  const chevron = (id) => find(h.mod.render(), id).nodes[0].nodes[0].svgPath;
  assert.equal(chevron('files-row-src'), 'mods/better-files/icons/chevron-down.svg', 'shut in the tree, open among the matches');
  await typeFilter(h, 'mai');
  assert.equal(h.execs.filter((e) => e.includes('--cached')).length, 1, 'typing more reads nothing again');
  h.mod.filter.handlers.submit({}, h.cx);
  assert.equal(tabs(h).length, 1);
  assert.equal(tabs(h)[0][1].name, 'main.go');
  click(h, 'files-filter-clear');
  assert.equal(h.mod.filter.value(), '');
  assert.deepEqual(rowIds(h), ['files-row-src', 'files-row-a.md', 'files-row-b.md']);
  assert.equal(find(h.mod.render(), 'files-row-src/main.go'), undefined, 'the tree is as it was, src still shut');
});

test('Escape clears the filter, and a folder picked from the matches opens in the tree and scrolls to it', async () => {
  const h = await ready();
  await typeFilter(h, 'zz');
  assert.match(strings(find(h.mod.render(), 'files-list')), /^No matches\.$/);
  let stopped = false;
  await typeFilter(h, 'sr');
  assert.deepEqual(rowIds(h), ['files-row-src']);
  click(h, 'files-row-src');
  await h.flush();
  assert.equal(h.mod.filter.value(), '');
  assert.ok(h.mod.folders.has('src'));
  h.mod.render();
  assert.deepEqual(h.scrolled, [0]);
  assert.ok(find(h.mod.render(), 'files-row-src/main.go'), 'the folder opened');
  await typeFilter(h, 'b.m');
  const keys = find(h.mod.render(), 'files-filter');
  keys.handlers.key({ key: 'escape', keystroke: 'escape' }, { stop_propagation: () => (stopped = true), notify() {} });
  assert.equal(h.mod.filter.value(), '');
  assert.equal(stopped, true);
});

test('Enter skips a matching folder for the first matching file, and a long list says it stops at 200', async () => {
  const h = await ready({ everything: 'docs/doc.md\0' });
  await typeFilter(h, 'doc');
  assert.deepEqual(rowIds(h), ['files-row-docs', 'files-row-docs/doc.md']);
  h.mod.filter.handlers.submit({}, h.cx);
  assert.equal(tabs(h)[0][1].name, 'doc.md');
  const many = await ready({ everything: Array.from({ length: 250 }, (_, i) => `n${i}.md`).join('\0') + '\0' });
  await typeFilter(many, '.md');
  assert.equal(rowIds(many).length, 200);
  assert.equal(strings(find(many.mod.render(), 'files-list').nodes.at(-1)), 'Showing the first 200 matches.');
});

test('outside a repo the filter uses find, shallower in a home folder, and says when the list was cut', async () => {
  const h = await ready({ top: null, found: './notes/todo.txt\0./notes/plan.txt\0./ca' });
  await typeFilter(h, 'plan');
  const call = h.execs.find((e) => e[0] === 'sh' && e[3] === 'index');
  assert.deepEqual(call.slice(3), ['index', '12', '4000000']);
  assert.match(call[2], /-name '\.git' -o -name 'node_modules'/);
  assert.deepEqual(rowIds(h), ['files-row-notes', 'files-row-notes/plan.txt']);
  assert.match(strings(find(h.mod.render(), 'files-list')), /only part of it was searched \(at most 40,000 files\)\.$/);
  const home = await ready({ top: null, cwd: '/home/kim', tree: { '/home/kim': [] } });
  await typeFilter(home, 'x');
  assert.deepEqual(home.execs.find((e) => e[0] === 'sh' && e[3] === 'index').slice(4), ['5', '4000000']);
});

test('the list is read again when it is old, and a failed read says why', async () => {
  const h = await ready();
  await typeFilter(h, 'main');
  h.mod.index.at = 0;
  h.tick();
  await h.flush();
  assert.equal(h.execs.filter((e) => e.includes('--cached')).length, 2);
  h.mod.index.at = Date.now() - 6000;
  h.mod.index.stale = true;
  h.mod.refresh(h.cx);
  await h.flush();
  assert.equal(h.execs.filter((e) => e.includes('--cached')).length, 3);
  const broken = await ready({ top: null });
  broken.context.exec = async () => ({ code: 1, stdout: '', stderr: 'find: permission denied' });
  await typeFilter(broken, 'x');
  assert.match(strings(find(broken.mod.render(), 'files-list')), /^find: permission denied$/);
});

test('a busy folder reads the list again at most every 5 seconds, and catches up after', async () => {
  const h = await ready();
  await typeFilter(h, 'main');
  const reads = () => h.execs.filter((e) => e.includes('--cached')).length;
  assert.equal(reads(), 1);
  for (let i = 0; i < 3; i++) {
    h.mod.index.stale = true;
    h.mod.refresh(h.cx);
    await h.flush();
  }
  assert.equal(reads(), 1);
  assert.equal(h.later.length, 1);
  assert.ok(h.later[0][0] > 4000 && h.later[0][0] <= 5000, `waits ${h.later[0][0]} ms`);
  h.mod.index.at = Date.now() - 6000;
  h.later[0][1](h.cx);
  await h.flush();
  assert.equal(reads(), 2);
  assert.equal(h.mod.index.stale, false);
  h.mod.index.stale = true;
  h.mod.refresh(h.cx);
  assert.equal(h.later.length, 2, 'the next busy spell waits too');
});

test('the filter leaves out a file deleted but not staged, and reads a folder Git ignores with find', async () => {
  const h = await ready({ deleted: 'b.md\0' });
  await typeFilter(h, '.md');
  assert.deepEqual(rowIds(h), ['files-row-a.md'], 'b.md is gone from disk');
  const ignored = await ready({ everything: '', found: './index.js\0' });
  await typeFilter(ignored, 'index');
  assert.equal(ignored.execs.filter((e) => e[0] === 'sh' && e[3] === 'index').length, 1, 'Git listed nothing, so find did');
  assert.deepEqual(rowIds(ignored), ['files-row-index.js']);
});

test('a change on disk while the list is being read leaves the new list stale', async () => {
  const h = await ready();
  const exec = h.context.exec;
  h.context.exec = async (bin, args, options) => {
    if (args.includes('--cached')) h.mod.changes = (h.mod.changes ?? 0) + 1;
    return exec(bin, args, options);
  };
  await typeFilter(h, 'main');
  assert.equal(h.mod.index.stale, true, 'it is read again once the wait is over');
  h.context.exec = exec;
  h.mod.index.at = Date.now() - 6000;
  h.mod.refresh(h.cx);
  await h.flush();
  assert.equal(h.mod.index.stale, false);
});

test('a folder picked from the matches opens even while the tree is still loading', async () => {
  const h = await ready();
  await typeFilter(h, 'sr');
  h.mod.loading = h.mod.key;
  click(h, 'files-row-src');
  await h.flush();
  assert.ok(find(h.mod.render(), 'files-row-src/main.go'), 'the folder has its files');
});

test('moving to another folder drops the last one\'s filter error, marker and the folder it was to scroll to', async () => {
  const tree = { ...TREE, '/elsewhere': [['d', 'src']], '/elsewhere/src': [] };
  const h = await ready({ tree });
  await typeFilter(h, 'sr');
  click(h, 'files-row-src');
  h.mod.indexError = 'find: permission denied';
  h.mod.cursor = 'src';
  h.live.panes[0].cwd = '/elsewhere';
  h.live.focused.cwd = '/elsewhere';
  h.tick();
  assert.equal(h.mod.indexError, null);
  assert.equal(h.mod.cursor, null, 'a marker from the last folder goes');
  await h.flush();
  h.mod.render();
  assert.deepEqual(h.scrolled, []);
});

const keyOn = (h, id, keystroke) => {
  let stopped = false;
  find(h.mod.render(), id).handlers.key({ keystroke, key: keystroke, modifiers: {} }, { ...h.cx, stop_propagation: () => { stopped = true; } });
  return stopped;
};
const press = (h, keystroke) => keyOn(h, 'files-list', keystroke);
const marked = (h) => {
  const out = [];
  const walk = (n) => { if (n?.elementId?.startsWith?.('files-row-') && n.border === '#accent') out.push(n.elementId.slice('files-row-'.length)); (n?.nodes ?? []).forEach(walk); };
  walk(h.mod.render());
  return out;
};

test('clicking the tree gives it the keyboard, and the arrows, j and k move a marker through the rows', async () => {
  const h = await ready();
  assert.deepEqual(marked(h), [], 'no marker before the tree has the keyboard');
  click(h, 'files-row-a.md');
  assert.equal(h.mod.treeFocus.is_focused(), true);
  assert.deepEqual(marked(h), ['a.md']);
  assert.equal(press(h, 'down'), true);
  assert.deepEqual(marked(h), ['b.md']);
  press(h, 'down');
  assert.deepEqual(marked(h), ['b.md'], 'it stops at the end');
  press(h, 'k');
  press(h, 'k');
  assert.deepEqual(marked(h), ['src']);
  press(h, 'j');
  assert.deepEqual(marked(h), ['a.md']);
  press(h, 'end');
  assert.deepEqual(marked(h), ['b.md']);
  press(h, 'home');
  assert.deepEqual(marked(h), ['src']);
  assert.deepEqual(h.scrolled.slice(-2), [2, 0], 'the marked row is scrolled into view');
  h.mod.cursor = null;
  press(h, 'home');
  assert.deepEqual(marked(h), ['src'], 'Home goes to the top with no marker too');
  h.mod.cursor = null;
  press(h, 'end');
  assert.deepEqual(marked(h), ['b.md'], 'and End to the bottom');
  press(h, 'home');
  assert.equal(press(h, 'x'), false, 'other keys go on to Herdr');
  assert.equal(press(h, 'escape'), true);
  assert.deepEqual(marked(h), []);
  assert.equal(press(h, 'escape'), false, 'with no marker, Escape goes on');
  const many = await ready({ tree: { '/repo': Array.from({ length: 25 }, (_, i) => ['f', `n${String(i).padStart(2, '0')}.txt`]) } });
  await many.command('focus');
  assert.deepEqual(marked(many), ['n00.txt'], 'the focus command marks the first row');
  press(many, 'pagedown');
  assert.deepEqual(marked(many), ['n10.txt']);
  press(many, 'pageup');
  assert.deepEqual(marked(many), ['n00.txt']);
});

test('right and left open and close folders and step in and out, and Enter opens a file or a folder', async () => {
  const h = await ready();
  await h.command('focus');
  assert.deepEqual(marked(h), ['src']);
  press(h, 'right');
  await h.flush();
  assert.ok(h.mod.folders.has('src'));
  assert.deepEqual(marked(h), ['src'], 'opening a folder stays on it');
  press(h, 'l');
  assert.deepEqual(marked(h), ['src/main.go'], 'then steps into it');
  press(h, 'h');
  assert.deepEqual(marked(h), ['src'], 'left goes to the folder above');
  press(h, 'left');
  assert.equal(h.mod.folders.has('src'), false, 'and then closes it');
  press(h, 'enter');
  await h.flush();
  assert.ok(h.mod.folders.has('src'), 'Enter opens a folder');
  press(h, 'down');
  press(h, 'enter');
  assert.equal(tabs(h).at(-1)[1].name, 'main.go', 'and opens a file in the shared tab');
});

test('/ goes to the filter, the arrows there move through the matches, and Enter opens the marked one', async () => {
  const h = await ready();
  await h.command('focus');
  assert.equal(press(h, '/'), true);
  assert.equal(h.mod.filter.focused, true);
  assert.deepEqual(marked(h), [], 'the tree has let go of the keyboard');
  await typeFilter(h, 'mai');
  assert.deepEqual(rowIds(h), ['files-row-src', 'files-row-src/main.go']);
  assert.equal(keyOn(h, 'files-filter', 'down'), true);
  assert.deepEqual(marked(h), ['src']);
  keyOn(h, 'files-filter', 'down');
  assert.deepEqual(marked(h), ['src/main.go']);
  h.mod.filter.handlers.submit({}, h.cx);
  assert.equal(tabs(h).at(-1)[1].name, 'main.go');
  keyOn(h, 'files-filter', 'up');
  h.mod.filter.handlers.submit({}, h.cx);
  await h.flush();
  assert.equal(h.mod.filter.value(), '', 'Enter on a folder opens it in the tree');
  assert.ok(find(h.mod.render(), 'files-row-src/main.go'));
  assert.deepEqual(marked(h), ['src'], 'and the tree takes the keyboard, on that folder');
});

test('dotfiles hide and show with the eye button or ., in the tree and the matches, and stay that way after a restart', async () => {
  const tree = { ...TREE, '/repo': [...TREE['/repo'], ['f', '.env'], ['d', '.github']] };
  const everything = `${EVERY}.env\0.github/ci.yml\0`;
  const h = await ready({ tree, everything });
  assert.ok(find(h.mod.render(), 'files-row-.env'));
  click(h, 'files-tool-dotfiles');
  assert.equal(find(h.mod.render(), 'files-row-.env'), undefined);
  assert.equal(find(h.mod.render(), 'files-row-.github'), undefined);
  assert.equal(h.kept.get('better-files.dotfiles'), 'false');
  await typeFilter(h, 'ci');
  assert.match(strings(find(h.mod.render(), 'files-list')), /^No matches\.$/);
  const again = await ready({ tree, everything, storage: { 'better-files.dotfiles': 'false' } });
  assert.equal(find(again.mod.render(), 'files-row-.env'), undefined, 'remembered');
  await again.command('focus');
  press(again, '.');
  assert.ok(find(again.mod.render(), 'files-row-.env'));
  assert.equal(again.kept.get('better-files.dotfiles'), 'true');
  await typeFilter(again, 'ci');
  assert.deepEqual(rowIds(again), ['files-row-.github', 'files-row-.github/ci.yml']);
});

test('collapse all closes every folder, and a marker inside one moves to its top folder', async () => {
  const h = await ready();
  await h.command('focus');
  press(h, 'right');
  await h.flush();
  press(h, 'down');
  assert.deepEqual(marked(h), ['src/main.go']);
  click(h, 'files-tool-collapse');
  assert.equal(find(h.mod.render(), 'files-row-src/main.go'), undefined);
  assert.equal(h.mod.folders.size, 0);
  assert.deepEqual(marked(h), ['src']);
  assert.equal(find(h.mod.render(), 'files-tool-collapse').handlers.click, undefined, 'nothing is left to close');
});

test('Right on a matching folder opens it in the tree, as Enter does', async () => {
  const h = await ready();
  await typeFilter(h, 'sr');
  h.mod.cursor = 'src';
  press(h, 'right');
  await h.flush();
  assert.equal(h.mod.filter.value(), '');
  assert.ok(h.mod.folders.has('src'));
  assert.deepEqual(marked(h), ['src']);
  assert.ok(find(h.mod.render(), 'files-row-src/main.go'), 'the folder opened');
});

test('with a file tab focused from the start, the tree shows where the space\'s terminal is, not where the space was made', async () => {
  const viewer = { pane: 'p2', tab: 'tab2', mod: 'better-files', cwd: null };
  const h = await ready({ spaceFolder: '/made-here', focusOn: viewer });
  assert.equal(h.mod.root, '/repo');
  assert.match(strings(find(h.mod.render(), 'files-title')), /^Files\s+repo$/);
  h.tick();
  assert.equal(h.mod.root, '/repo', 'and it stays there');
  const alone = await ready({ spaceFolder: '/made-here', focusOn: viewer });
  alone.live.panes.splice(0, 1);
  alone.mod.place = null;
  alone.tick();
  assert.equal(alone.mod.root, '/made-here', 'a space with no terminal falls back to its own folder');
});

test('with a file focused beside a terminal, the tree follows that terminal, not one in an earlier tab', async () => {
  const viewer = { pane: 'p3', tab: 'tab2', mod: 'better-files', cwd: null };
  const h = await ready({ spaceFolder: '/made-here', focusOn: viewer });
  h.live.panes.push({ pane: 'p2', tab: 'tab2', cwd: '/repo/src' });
  h.mod.place = null;
  h.tick();
  assert.equal(h.mod.root, '/repo/src');
});

test('a picture\'s copy is named for what is in it, so a changed one, or one after a restart, never shows an old copy', async () => {
  const file = { path: '/repo/shot.PNG', root: '/repo', on: null };
  const shown = (h) => strings(find(h.mod.render(), 'viewer-image'));
  const h = await ready({ mode: 'viewer', viewer: 'v', file });
  assert.match(shown(h), /^image:mods\/better-files\/\.cache\/v-111-3\.png$/);
  h.live.pictures['/repo/shot.PNG'] = '222-4';
  h.tick();
  await h.flush();
  assert.match(shown(h), /^image:mods\/better-files\/\.cache\/v-222-4\.png$/);
  assert.equal(h.execs.filter((e) => e[3] === 'copy-image').at(-1)[8], '/app/mods/better-files/.cache/v-111-3.png', 'the old copy goes');
  const again = await ready({ mode: 'viewer', viewer: 'v', file, pictures: { '/repo/shot.PNG': '333-5' } });
  assert.match(shown(again), /^image:mods\/better-files\/\.cache\/v-333-5\.png$/, 'a restarted tab with another picture never reuses a name');
  const busy = await ready({ mode: 'viewer', viewer: 'v', file });
  busy.context.exec = async () => ({ code: 75, stdout: '' });
  busy.tick();
  await busy.flush();
  assert.match(shown(busy), /^image:mods\/better-files\/\.cache\/v-111-3\.png$/, 'a picture still being written keeps the last copy');
});

test('a Markdown picture keeps its last copy on screen until the new one is there', async () => {
  let release;
  const h = await mdWorld();
  assert.match(strings(h.mod.render()), /image:mods\/better-files\/\.cache\/v-m1-111-3\.png/);
  const exec = h.context.exec;
  h.context.exec = (bin, args, o) => (args[2] === 'copy-image' ? new Promise((done) => (release = () => done({ code: 0, stdout: 'v-m1-222-4.png' }))) : exec(bin, args, o));
  h.live.texts['/repo/docs/guide.md'] += ' ';
  h.tick();
  await h.flush();
  assert.match(strings(h.mod.render()), /image:mods\/better-files\/\.cache\/v-m1-111-3\.png/, 'not a name with nothing there yet');
  const before = h.cx.notified;
  release();
  await h.flush();
  assert.ok(h.cx.notified > before, 'the new copy is drawn');
  assert.match(strings(h.mod.render()), /image:mods\/better-files\/\.cache\/v-m1-222-4\.png/);
  assert.doesNotMatch(strings(h.mod.render()), /v-m1-111-3/);
  h.context.exec = (bin, args, o) => (args[2] === 'copy-image' ? Promise.resolve({ code: 75, stdout: '' }) : exec(bin, args, o));
  h.live.texts['/repo/docs/guide.md'] += ' ';
  h.tick();
  await h.flush();
  assert.match(strings(h.mod.render()), /image:mods\/better-files\/\.cache\/v-m1-222-4\.png/, 'a picture still being written keeps the last copy');
});

test('the copy script names a copy by its checksum, copies once, and removes the copy it replaces', async () => {
  const { context: m } = await ready();
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-copy-'));
  const cache = path.join(dir, '.cache');
  const run = (args, env) => spawnSync('sh', ['-c', m.COPY_IMAGE, 'copy-image', ...args], { encoding: 'utf8', env: env ?? process.env });
  const src = path.join(dir, 'a.png');
  fs.writeFileSync(src, 'one');
  const first = run([src, cache, 'v', 'png', '']);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /^v-\d+-3\.png$/);
  assert.equal(fs.readFileSync(path.join(cache, first.stdout), 'utf8'), 'one');
  const kept = fs.statSync(path.join(cache, first.stdout)).ino;
  assert.equal(run([src, cache, 'v', 'png', path.join(cache, first.stdout)]).stdout, first.stdout, 'the same picture keeps its name and its copy');
  assert.equal(fs.statSync(path.join(cache, first.stdout)).ino, kept, 'not copied again');
  fs.writeFileSync(src, 'two!');
  const second = run([src, cache, 'v', 'png', path.join(cache, first.stdout)]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /^v-\d+-4\.png$/);
  assert.equal(fs.readFileSync(path.join(cache, second.stdout), 'utf8'), 'two!');
  assert.equal(fs.existsSync(path.join(cache, first.stdout)), false, 'the replaced copy goes');
  const gone = run([path.join(dir, 'gone.png'), cache, 'v', 'png', '']);
  assert.notEqual(gone.status, 0);
  assert.equal(gone.stdout, '');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cp'), '#!/bin/sh\nprintf changed > "$3"\n', { mode: 0o755 });
  fs.writeFileSync(src, 'three');
  const busy = run([src, cache, 'v', 'png', path.join(cache, second.stdout)], { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(busy.status, 75, 'a picture that changed while it was copied');
  assert.deepEqual(fs.readdirSync(cache), [second.stdout], 'nothing half-copied is left, and the shown copy stays');
  fs.rmSync(dir, { recursive: true });
});

test('env files, unknown types and each language\'s own keywords', async () => {
  const { context: m } = await ready();
  const tokens = (line, lang) => JSON.parse(JSON.stringify(m.tokenizeLine(line, lang).runs.filter((r) => r.kind).map((r) => [r.text, r.kind])));
  const env = '.' + 'env';
  assert.equal(m.lexerLanguage(env), 'env');
  assert.equal(m.lexerLanguage(`app/${env}.test`), 'env', 'whatever follows the dot');
  assert.deepEqual(tokens('### auth - needed only for local development', 'env'), [['### auth - needed only for local development', 'comment']]);
  assert.deepEqual(tokens('export APP_URL=http://localhost:3000', 'env'), [['APP_URL', 'property'], ['3000', 'number']]);
  assert.deepEqual(tokens('APP_ID=061abc', 'env'), [['APP_ID', 'property']], 'digits running into letters are a value');
  assert.deepEqual(tokens('for x in list return y', 'unknownext'), [], 'an unknown type stays plain');
  assert.deepEqual(tokens('local and or', 'ts'), [], 'not TypeScript keywords');
  assert.deepEqual(tokens('local x = 1', 'lua'), [['local', 'keyword'], ['1', 'number']]);
  assert.deepEqual(tokens('for i := range xs {', 'go'), [['for', 'keyword'], ['range', 'keyword']]);
  assert.deepEqual(tokens('fun main() { val x = 1 }', m.lexerLanguage('a.kt')), [['fun', 'keyword'], ['main', 'function'], ['val', 'keyword'], ['1', 'number']]);
  assert.deepEqual(tokens('FROM node:24 AS build', m.lexerLanguage('Dockerfile')), [['FROM', 'keyword'], ['24', 'number'], ['AS', 'keyword']]);
});

test('files whose names hide their language are read as it', async () => {
  const { context: m } = await ready();
  const cases = {
    'tsconfig.json': 'jsonc', 'tsconfig.app.json': 'jsonc', 'a/.vscode/settings.json': 'jsonc',
    '.devcontainer/devcontainer.json': 'jsonc', 'package.json': 'json', '.babelrc': 'jsonc', '.nuxtrc': 'env',
    'Brewfile': 'rb', 'Containerfile': 'dockerfile', 'tsconfig-base.json': 'jsonc', 'jsconfig_build.json': 'jsonc',
    'tsconfigs.json': 'json',
  };
  for (const [path, lang] of Object.entries(cases)) assert.equal(m.lexerLanguage(path), lang, path);
  const tokens = (line, path) => JSON.parse(JSON.stringify(m.tokenizeLine(line, m.lexerLanguage(path)).runs.filter((r) => r.kind).map((r) => [r.text, r.kind])));
  assert.deepEqual(tokens('  // the folders', 'portfolio.code-workspace'), [['// the folders', 'comment']]);
  assert.deepEqual(tokens('model User {', 'schema.prisma'), [['model', 'keyword'], ['User', 'type']]);
  assert.deepEqual(tokens('type Query { me: User }', 'q.gql'), [['type', 'keyword'], ['Query', 'type'], ['User', 'type']]);
  const described = JSON.parse(JSON.stringify(m.highlightLines(['"""', 'The type of a user, for query input', '"""', 'type User'], 'graphql')
    .map((runs) => runs.filter((r) => r.kind).map((r) => [r.text, r.kind]))));
  assert.deepEqual(described, [[['"""', 'string']], [['The type of a user, for query input', 'string']], [['"""', 'string']], [['type', 'keyword'], ['User', 'type']]]);
  assert.deepEqual(tokens('  "name": "x"', 'site.webmanifest'), [['"name"', 'property'], ['"x"', 'string']]);
  assert.deepEqual(tokens('<Project Sdk="x">', 'app.csproj'), [['<Project', 'tag'], ['Sdk', 'attribute'], ['"x"', 'string']]);
});

test('a file over the whole-file limit keeps its own text and is coloured a row at a time', async () => {
  const filler = Array.from({ length: 5001 }, (_, i) => `// line ${i}`);
  const text = ['/* note', 'still note */ const A = 1', ...filler].join('\n');
  const file = { path: '/repo/big.ts', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/big.ts': text } });
  const colorOf = (node, s) => (node?.nodes?.includes(s) ? node.colors.at(-1) : node?.nodes?.map((n) => colorOf(n, s)).find(Boolean));
  const row = find(h.mod.render(), 'viewer-line-1');
  assert.ok(row, 'the second row is drawn');
  assert.equal(colorOf(row, 'const'), '#ansi5', 'still coloured');
  assert.notEqual(colorOf(row, 'still note */'), '#dim', 'no comment carried from the line above');
});

test('the lexer\'s edge cases keep text and state right', async () => {
  const { context: m } = await ready();
  const lines = (list, lang) => JSON.parse(JSON.stringify(m.highlightLines(list, lang)));
  const coloured = (list, lang) => lines(list, lang).map((runs) => runs.filter((r) => r.kind).map((r) => [r.text, r.kind]));
  const text = (list, lang) => lines(list, lang).map((runs) => runs.map((r) => r.text).join(''));
  const css = ['/* old', '  color: red; */', 'a { color: red; }'];
  assert.deepEqual(text(css, 'css'), css, 'a key after a closed comment is not drawn twice');
  assert.deepEqual(coloured(['s = s.replace(/\\/*$/, "");', 'const x = 1;'], 'js'), [[['replace', 'function'], ['/\\/*$/', 'string'], ['""', 'string']], [['const', 'keyword'], ['1', 'number']]], 'a regex opens no comment');
  assert.deepEqual(coloured(['n = a / b / 2;'], 'ts'), [[['2', 'number']]], 'division is not a regex');
  assert.deepEqual(coloured(['re := `C:\\`', 'x := 1'], 'go'), [[['`C:\\`', 'string']], [['1', 'number']]], 'a Go raw string has no escapes');
  const long = 'x'.repeat(2100);
  assert.deepEqual(coloured(['/* a', long, 'b */ const y = 2'], 'js')[2], [['b */', 'comment'], ['const', 'keyword'], ['2', 'number']], 'a long line keeps the comment open');
  assert.deepEqual(coloured(['echo ${#arr[@]} $# done # note'], 'sh')[0].filter(([, k]) => k === 'comment'), [['# note', 'comment']], 'a # inside a word is no comment');
  assert.deepEqual(coloured(['<Button onClick={() => go()} disabled />'], 'tsx')[0].filter(([, k]) => k === 'attribute'), [['onClick', 'attribute'], ['disabled', 'attribute']], 'an arrow in a prop does not close the tag');
  assert.deepEqual(coloured(["$a = 'hello';"], m.lexerLanguage('a.php')), [[["'hello'", 'string']]], 'PHP single quotes are strings');
  assert.deepEqual(coloured(["let c = 'x';"], 'rs')[0].filter(([, k]) => k === 'string'), [["'x'", 'string']], 'Rust keeps its char literals');
});

test('the row view recolours when another file has the same text', async () => {
  const file = { path: '/repo/a.py', root: '/repo', on: null };
  const h = await ready({ mode: 'viewer', viewer: 'v', file, texts: { '/repo/a.py': 'def f(): pass' } });
  const lines = ['let x = 1'];
  const kinds = () => JSON.parse(JSON.stringify(h.mod.lineRuns(lines)[0].filter((r) => r.kind).map((r) => r.kind)));
  assert.deepEqual(kinds(), ['number'], 'let is not a Python keyword');
  h.mod.file = { ...file, path: '/repo/a.js' };
  assert.deepEqual(kinds(), ['keyword', 'number'], 'the same lines, coloured as JavaScript');
});

test('syntax.js is the same file in Better Files and Better Changes', () => {
  const read = (mod) => fs.readFileSync(path.join(__dirname, `../../${mod}/mods/${mod}/syntax.js`), 'utf8');
  assert.equal(read('better-files'), read('better-changes'));
});

test('a picture copy that finishes after its tab moved on is replaced later, and one that finishes after the tab closed goes', async () => {
  const file = { path: '/repo/shot.PNG', root: '/repo', on: null };
  const copies = (h) => h.execs.filter((e) => e[3] === 'copy-image');
  const h = await ready({ mode: 'viewer', viewer: 'v', file });
  const exec = h.context.exec;
  let release;
  h.context.exec = (bin, args, o) => (args[2] === 'copy-image' ? new Promise((done) => (release = done)) : exec(bin, args, o));
  h.tick();
  await h.flush();
  h.store.set('better-files.viewers', { v: { file: { ...file, path: '/repo/other.jpg' }, tab: 'tab1' } });
  release({ code: 0, stdout: 'v-222-4.png' });
  await h.flush();
  h.context.exec = exec;
  h.tick();
  await h.flush();
  assert.equal(copies(h).at(-1)[4], '/repo/other.jpg');
  assert.equal(copies(h).at(-1)[8], '/app/mods/better-files/.cache/v-222-4.png', 'the late copy is the one the next replaces');
  const shut = await ready({ mode: 'viewer', viewer: 'v', file });
  const shutExec = shut.context.exec;
  shut.context.exec = (bin, args, o) => (args[2] === 'copy-image' ? new Promise((done) => (release = done)) : shutExec(bin, args, o));
  shut.tick();
  await shut.flush();
  await shut.mod.close();
  release({ code: 0, stdout: 'v-222-4.png' });
  await shut.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(shut.execs.at(-1))), ['rm', '-f', '--', '/app/mods/better-files/.cache/v-222-4.png']);
});

test('the copy script clears a restarted tab\'s leftovers, and a failed copy leaves nothing half-made', async () => {
  const { context: m } = await ready();
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-sweep-'));
  const cache = path.join(dir, '.cache');
  const run = (args, env) => spawnSync('sh', ['-c', m.COPY_IMAGE, 'copy-image', ...args], { encoding: 'utf8', env: env ?? process.env });
  const files = () => fs.readdirSync(cache).sort();
  fs.mkdirSync(cache);
  for (const name of ['v-1-1.png', 'v-1-1.jpg', 'v-2-2.png.part', 'v-m1-3-3.png', 'w-4-4.png']) fs.writeFileSync(path.join(cache, name), 'old');
  const src = path.join(dir, 'a.png');
  fs.writeFileSync(src, 'one');
  const first = run([src, cache, 'v', 'png', '']);
  assert.equal(first.status, 0);
  assert.deepEqual(files(), [first.stdout, 'v-m1-3-3.png', 'w-4-4.png'].sort(), 'only this start\'s copies go, not its Markdown pictures or another tab\'s');
  fs.writeFileSync(path.join(cache, 'v-9-9.png'), 'old');
  fs.writeFileSync(src, 'two!');
  const second = run([src, cache, 'v', 'png', path.join(cache, first.stdout)]);
  assert.deepEqual(files(), [second.stdout, 'v-9-9.png', 'v-m1-3-3.png', 'w-4-4.png'].sort(), 'with a copy to replace, only that one goes');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cp'), '#!/bin/sh\nprintf half > "$3"\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(src, 'three');
  const failed = run([src, cache, 'v', 'png', path.join(cache, second.stdout)], { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(failed.status, 1);
  assert.deepEqual(files(), [second.stdout, 'v-9-9.png', 'v-m1-3-3.png', 'w-4-4.png'].sort(), 'no part left, and the shown copy stays');
  fs.rmSync(dir, { recursive: true });
});

test('with no tab shown, the tree takes a terminal in the space, not a pane from elsewhere', async () => {
  const h = await ready({ spaceFolder: '/made-here' });
  h.live.panes.splice(0, h.live.panes.length, { pane: 'x', space: 'other', cwd: '/elsewhere' }, { pane: 'p2', tab: 'tab1', cwd: '/repo/src' });
  h.live.focused = { space: 's', tab: 'tab1', pane: 'gone', cwd: null };
  h.mod.place = null;
  h.tick();
  assert.equal(h.mod.root, '/repo/src');
});
