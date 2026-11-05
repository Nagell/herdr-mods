// The panel against stand-ins for Herdr and the helper. Nothing here starts an agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../mods/factory');
const FILES = ['settings.js', 'run/model.js', 'views/ui.js', 'views/days.js', 'run/reads.js', 'actions/menus.js', 'actions/commands.js', 'views/run.js', 'views/empty.js', 'views/events.js', 'main.js'];
const source = FILES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n')
  .replace(/^import\s+[\s\S]*?;$/gm, '')
  .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
  .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { runStats });';

const WORKFLOWS = [{ name: 'implement', description: 'Build then review', stages: [{ id: 'dev' }, { id: 'review' }] }, { name: 'review', stages: [{ id: 'review' }] }];

function harness({ run = null, terminals = [], agents = [], results = {}, helper, missing = [], space = {} } = {}) {
  const pending = [], timers = [], ran = [], sent = [], calls = [];
  const cx = { focus_handle: () => ({ focus() {} }), stop_propagation() {}, notify() {}, spawn(fn) { pending.push(fn(cx)); }, timer: { every(_ms, fn) { timers.push(fn); }, after() {} } };
  function el() {
    const data = { nodes: [], handlers: {} };
    const proxy = new Proxy(data, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'child' || k === 'trigger' || k === 'content') return (c) => { t.nodes.push(c); return proxy; };
        if (k === 'children') return (c) => { t.nodes.push(...c); return proxy; };
        if (k === 'when') return (b, f) => { if (b) f(proxy); return proxy; };
        return (...a) => {
          if (k === 'id') t.elementId = a[0];
          if (k === 'on_click') t.handlers.click = a[0];
          if (k === 'on_open_change') t.handlers.open = a[0];
          return proxy;
        };
      },
    });
    return proxy;
  }
  const state = () => ({ text: '', value() { return this.text; }, set_value(v) { this.text = v; }, on() {}, focus() {} });
  const files = { '/repo/.herdr-factory/run.json': run && JSON.stringify(run), ...results };
  const storage = new Map();
  const live = { terminals, agents, shown: true };
  const context = {
    View: class {}, div: el, svg: el, image: el, v_flex: el, h_flex: el,
    Popover: { new: (id) => el().id(id) }, Textarea: { new: () => el() }, TextareaState: { new: state },
    spaces: () => [{ id: 's', active: true, folder: '/repo', ...space }],
    terminals: () => live.terminals, agents: () => live.agents,
    layout: () => (live.shown ? { content: { mod: 'factory' } } : { content: { mod: 'other' } }),
    theme: () => new Proxy({}, { get: (_t, k) => `#${String(k)}` }), settings: () => ({ font_family: 'Code' }),
    appHome: () => '/app', home: () => '/home/sam', nextCommand: () => new Promise(() => {}),
    run: (name, args) => ran.push([name, args]), runCommand: (name, args) => ran.push([name, args]),
    hc: async (args) => { sent.push(args); return { code: 0, stdout: '{}' }; },
    exec: async (bin, args) => {
      calls.push([bin.split('/').pop(), ...args]);
      if (helper) { const answer = helper(args); if (answer) return answer; }
      if (args[0] === 'list') return { code: 0, stdout: JSON.stringify(WORKFLOWS) };
      if (args[0] === 'tools') return { code: 0, stdout: JSON.stringify({ missing }) };
      return { code: 0, stdout: '' };
    },
    readTextFile: async (p) => { if (p.endsWith('mod.json')) return null; return files[p] ?? null; },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const mod = new context.Mod();
  mod.init({}, cx);
  // Not a wait for every task: the panel's command listener never finishes.
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
  return { mod, cx, live, files, ran, sent, calls, context, flush, tick: () => { for (const fn of timers) fn(cx); } };
}
const ready = async (options) => { const h = harness(options); await h.flush(); return h; };
const find = (node, id) => (node?.elementId === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const strings = (node) => (typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' '));
const click = (h, id) => { const node = find(h.mod.render(), id); assert.ok(node, `no ${id}`); assert.ok(node.handlers.click, `${id} isn't clickable`); node.handlers.click({}, h.cx); };
const choose = (h, menu, option) => { find(h.mod.render(), menu).handlers.open(true, h.cx); click(h, `${menu}-option-${option}`); };
const helperCalls = (h) => h.calls.filter((c) => c[0] === 'factory' && !['list', 'tools'].includes(c[1])).map((c) => c.slice(1).join(' '));

const stage = (over) => ({ id: 'dev', role: 'developer', model: 'claude-opus-5-5', effort: 'medium', state: 'working', terminal: 't9', attempt: 1, ...over });
const RUN = (stages, over = {}) => ({ orchestrator: 't1', state: 'working', workflow: 'implement', started: '2026-01-01T10:00:00', stages, events: [{ at: '2026-01-01T10:00:00', text: 'run implement' }, { at: '2026-01-01T10:00:01', text: 'dev started (attempt 1)', stage: 'dev' }], ...over });
const session = (address, over = {}) => ({ address, state: 'live', program: {}, ...over });

test('with no run it says how to start one and lists the workflows, offering no way to start here', async () => {
  const h = await ready();
  const body = strings(find(h.mod.render(), 'factory-empty'));
  assert.match(body, /No run here[\s\S]*\/factory implement[\s\S]*dev → review[\s\S]*Build then review[\s\S]*\/factory review/);
  assert.equal(find(h.mod.render(), 'factory-send'), undefined);
  click(h, 'factory-open-folder');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['init']);
  const none = await ready({ helper: (args) => (args[0] === 'list' ? { code: 0, stdout: '[]' } : null) });
  assert.match(strings(none.mod.render()), /No workflows\. Add one to \/home\/sam\/\.config\/herdr-mods\/factory\/workflow\.json/);
});

test('a run with no orchestrator says how to pick it up, and nothing here sends to an agent', async () => {
  const h = await ready({ run: RUN([stage({ state: 'stopped', terminal: '' })], { state: 'stopped' }) });
  assert.match(strings(find(h.mod.render(), 'factory-orchestrator')), /\/factory continue/);
  find(h.mod.render(), 'factory-actions').handlers.open(true, h.cx);
  assert.doesNotMatch(strings(find(h.mod.render(), 'factory-actions-menu')), /Continue|New run|Run again/);
  assert.equal(h.sent.length, 0);
});

test('missing tools and helper failures are said in the panel', async () => {
  const h = await ready({ missing: ['hc', 'claude'] });
  assert.match(strings(h.mod.render()), /hc and claude aren't on your PATH/);
  const broken = await ready({ helper: (args) => (args[0] === 'list' ? { code: 1, stderr: 'workflow.json: bad' } : null) });
  assert.match(strings(broken.mod.render()), /workflow\.json: bad/);
});

test('a run shows its stats, the orchestrator and each stage with what it is doing', async () => {
  const stages = [stage({ state: 'done', summary: 'Added a flag', replies: 2, attempt: 2 }), stage({ id: 'review', role: 'reviewer', state: 'done', terminal: 't10', counts: { critical: 1, low: 2 }, loop: { with: 'dev', max: 3 }, round: 1 }), stage({ id: 'docs', state: 'queued', terminal: '', attempt: 0, after: ['review'] })];
  const h = await ready({ run: RUN(stages), terminals: [session('t1', { status: 'working' }), session('t9'), session('t10'), session('t44', { parent: 't9', name: 'helper-one', status: 'blocked' })] });
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'factory-stats')), /Stages[\s\S]*2\/3[\s\S]*Findings[\s\S]*3[\s\S]*Round[\s\S]*1\/3/);
  assert.match(strings(find(tree, 'factory-stage-dev')), /Added a flag · addressed 2[\s\S]*claude-opus-5-5 · medium · developer/);
  assert.match(strings(find(tree, 'factory-stage-review')), /1 critical, 2 low/);
  assert.match(strings(find(tree, 'factory-stage-docs')), /After review/);
  assert.match(strings(find(tree, 'factory-helper-t44')), /helper-one/);
  find(tree, 'factory-stage-dev').handlers.click({}, h.cx);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ran[0])), ['terminal.peek', { terminal: 't9' }]);
  find(tree, 'factory-orchestrator').handlers.click({}, h.cx);
  assert.equal(h.ran[1][1].terminal, 't1');
});

test('live state corrects the record', async () => {
  const h = await ready({ run: RUN([stage({ id: 'a', terminal: 't2' }), stage({ id: 'b', terminal: 't3' })]), terminals: [session('t1'), session('t3', { status: 'blocked' })] });
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'factory-stage-a')), /Session ended/);
  assert.match(strings(find(tree, 'factory-stage-b')), /Needs you/);
});

test('actions offer only what fits the run, and stopping asks first', async () => {
  const h = await ready({ run: RUN([stage({})]), terminals: [session('t1'), session('t9')] });
  find(h.mod.render(), 'factory-actions').handlers.open(true, h.cx);
  const menu = strings(find(h.mod.render(), 'factory-actions-menu'));
  assert.match(menu, /Stop run[\s\S]*Open workflows folder[\s\S]*Close Factory and every session/);
  assert.doesNotMatch(menu, /New run|Continue|Run again/);
  click(h, 'factory-actions-option-stop');
  assert.deepEqual(helperCalls(h), []);
  assert.match(strings(find(h.mod.render(), 'factory-confirm')), /Stop the run/);
  click(h, 'factory-confirm-yes');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['stop']);
  assert.equal(h.mod.confirm, null);
});

test('a stage can rerun, and closing a working one asks first', async () => {
  const h = await ready({ run: RUN([stage({ state: 'done', terminal: 't9' }), stage({ id: 'review', terminal: 't10' })], { state: 'working' }), terminals: [session('t1'), session('t9'), session('t10')] });
  click(h, 'factory-rerun-dev');
  await h.flush();
  click(h, 'factory-close-dev');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['rerun dev', 'close dev']);
  click(h, 'factory-close-review');
  assert.match(strings(find(h.mod.render(), 'factory-confirm')), /Its work in progress stops/);
  assert.equal(find(h.mod.render(), 'factory-rerun-review'), undefined, 'a working stage has no rerun');
});

test('a done stage opens to its findings by severity, which collapse', async () => {
  const result = { summary: 'Two problems', findings: [{ id: 'r1', severity: 'high', file: 'a.go', line: 3, title: 'Drops data', detail: 'Why' }, { id: 'r2', severity: 'low', title: 'Naming' }], replies: { r0: 'Fixed' } };
  const h = await ready({ run: RUN([stage({ id: 'review', state: 'done', counts: { high: 1, low: 1 } })], { state: 'done' }), terminals: [session('t1')], results: { '/repo/.herdr-factory/review-1.json': JSON.stringify(result) } });
  click(h, 'factory-open-review');
  await h.flush();
  let body = strings(find(h.mod.render(), 'factory-tree'));
  assert.match(body, /Two problems[\s\S]*High[\s\S]*Drops data[\s\S]*a\.go:3[\s\S]*Why[\s\S]*Low[\s\S]*Naming[\s\S]*Replies[\s\S]*r0: Fixed/);
  click(h, 'factory-findings-review-high');
  body = strings(find(h.mod.render(), 'factory-tree'));
  assert.doesNotMatch(body, /Drops data/);
  assert.match(body, /Naming/);
});

test('a missing result says so', async () => {
  const h = await ready({ run: RUN([stage({ state: 'done' })], { state: 'done' }), terminals: [session('t1')] });
  click(h, 'factory-open-dev');
  await h.flush();
  assert.match(strings(h.mod.render()), /No result recorded/);
});

test('a follow-up goes to the stage through the helper; a failure keeps the text', async () => {
  let fail = true;
  const h = await ready({ run: RUN([stage({ state: 'done' })], { state: 'done' }), terminals: [session('t1'), session('t9')], helper: (args) => (args[0] === 'followup' && fail ? { code: 1, stderr: 'stage is running' } : null) });
  click(h, 'factory-open-dev');
  await h.flush();
  click(h, 'factory-followup-open-dev');
  assert.equal(find(h.mod.render(), 'factory-followup-send').handlers.click, undefined, 'nothing to send yet');
  h.mod.editor.set_value('Also add a test');
  click(h, 'factory-followup-send');
  await h.flush();
  assert.match(strings(h.mod.render()), /stage is running/);
  assert.equal(h.mod.editor.value(), 'Also add a test');
  fail = false;
  click(h, 'factory-followup-send');
  await h.flush();
  assert.equal(helperCalls(h).at(-1), 'followup dev Also add a test');
  assert.equal(h.mod.followUp, null);
  assert.equal(h.mod.editor.value(), '');
});

test('no follow-up while a stage runs or with no orchestrator to report to', async () => {
  const busy = await ready({ run: RUN([stage({ state: 'done' }), stage({ id: 'b', terminal: 't3' })]), terminals: [session('t1'), session('t3')] });
  click(busy, 'factory-open-dev');
  await busy.flush();
  assert.equal(find(busy.mod.render(), 'factory-followup-open-dev'), undefined);
  const gone = await ready({ run: RUN([stage({ state: 'done' })], { state: 'done' }) });
  click(gone, 'factory-open-dev');
  await gone.flush();
  assert.equal(find(gone.mod.render(), 'factory-followup-open-dev'), undefined);
});

test('events group by day, newest first, and filter by stage or the run itself', async () => {
  const h = await ready({ run: RUN([stage({})]), terminals: [session('t1'), session('t9')] });
  click(h, 'factory-tab-events');
  let list = strings(find(h.mod.render(), 'factory-events'));
  assert.ok(list.indexOf('dev started') < list.indexOf('run implement'));
  choose(h, 'factory-events-pick', 'dev');
  list = strings(find(h.mod.render(), 'factory-events'));
  assert.match(list, /dev started/);
  assert.doesNotMatch(list, /run implement/);
  choose(h, 'factory-events-pick', 'run');
  list = strings(find(h.mod.render(), 'factory-events'));
  assert.match(list, /run implement/);
  assert.doesNotMatch(list, /dev started/);
});

test('a space on another machine gets a notice instead of the run', async () => {
  const h = await ready({ space: { machine: 'box' }, run: RUN([stage({})]) });
  assert.match(strings(h.mod.render()), /Runs work on this computer only/);
  assert.equal(find(h.mod.render(), 'factory-tree'), undefined);
});

test('a hidden panel reads nothing', async () => {
  const h = await ready();
  h.live.shown = false;
  h.files['/repo/.herdr-factory/run.json'] = JSON.stringify(RUN([stage({})]));
  h.tick();
  await h.flush();
  assert.equal(h.mod.current(), null);
  h.live.shown = true;
  h.tick();
  await h.flush();
  assert.equal(h.mod.current().workflow, 'implement');
});

test('stats leave out what a run has no use for', async () => {
  const { context: m } = harness();
  const keys = (r) => [...m.runStats(r)].map((s) => s.key).join();
  assert.equal(keys(RUN([stage({})])), 'stages');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: {} })]))[1].tone, 'good');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: { medium: 1 } })]))[1].tone, 'waiting');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: { high: 1 } })]))[1].tone, 'danger');
});
