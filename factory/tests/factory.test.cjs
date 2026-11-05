// The panel against stand-ins for Herdr and the helper. Nothing here starts an agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../mods/factory');
const FILES = ['settings.js', 'run/model.js', 'views/ui.js', 'views/days.js', 'run/reads.js', 'actions/menus.js', 'actions/commands.js', 'views/run.js', 'views/workflows.js', 'views/empty.js', 'views/events.js', 'main.js'];
const source = FILES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n')
  .replace(/^import\s+[\s\S]*?;$/gm, '')
  .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
  .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { runStats });';

const WORKFLOWS = [{ name: 'implement', source: 'base', description: 'Build then review', stages: [{ id: 'dev' }, { id: 'review' }] }, { name: 'review', source: 'base', stages: [{ id: 'review' }] }];

function harness({ run = null, terminals = [], agents = [], results = {}, helper, missing = [], space = {}, history = [] } = {}) {
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
    Popover: { new: (id) => el().id(id) }, Textarea: { new: () => el() }, TextView: { html: (id, html) => el().id(id).child(html) }, TextareaState: { new: state },
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
      if (args[0] === 'history') return { code: 0, stdout: JSON.stringify(history) };
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
const helperCalls = (h) => h.calls.filter((c) => c[0] === 'factory' && !['list', 'tools', 'history'].includes(c[1])).map((c) => c.slice(1).join(' '));

const stage = (over) => ({ id: 'dev', role: 'developer', model: 'claude-opus-5-5', effort: 'medium', state: 'working', terminal: 't9', attempt: 1, ...over });
const RUN = (stages, over = {}) => ({ orchestrator: 't1', state: 'working', workflow: 'implement', started: '2026-01-01T10:00:00', stages, events: [{ at: '2026-01-01T10:00:00', text: 'run implement' }, { at: '2026-01-01T10:00:01', text: 'dev started (attempt 1)', stage: 'dev' }], ...over });
const session = (address, over = {}) => ({ address, state: 'live', program: {}, ...over });

test('with no run it points to Workflows', async () => {
  const h = await ready();
  const body = strings(find(h.mod.render(), 'factory-empty'));
  assert.match(body, /No run here\. Start one from Workflows/);
  assert.equal(find(h.mod.render(), 'factory-send'), undefined);
  const none = await ready({ helper: (args) => (args[0] === 'list' ? { code: 0, stdout: '[]' } : null) });
  click(none, 'factory-tab-workflows');
  await none.flush();
  assert.match(strings(none.mod.render()), /No workflows\. Add one to \/home\/sam\/\.config\/herdr-mods\/factory\/workflow\.json/);
});

test('a run with no orchestrator says how to pick it up, and nothing here sends to an agent', async () => {
  const h = await ready({ run: RUN([stage({ state: 'stopped', terminal: '' })], { state: 'stopped' }) });
  assert.match(strings(find(h.mod.render(), 'factory-orchestrator')), /\/factory continue/);
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
  assert.match(strings(find(tree, 'factory-stage-docs')), /After Review/);
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

test('workflows group by where they come from, and one starts in its own Claude session', async () => {
  const list = [{ name: 'implement', source: 'repo', path: '/repo/.herdr-factory/workflow.json', description: 'Build then review', stages: [{ id: 'dev', role: 'developer', model: 'm' }, { id: 'review', role: 'reviewer', loop: { with: 'dev', max: 3 } }] }, { name: 'base:implement', source: 'base', extra_args: ['--permission-mode', 'auto'], path: '/home/sam/.config/herdr-mods/factory/workflow.json', stages: [{ id: 'dev', role: 'developer' }] }];
  const helper = (args) => (args[0] === 'list' ? { code: 0, stdout: JSON.stringify(list) } : null);
  const h = await ready({ helper });
  click(h, 'factory-tab-workflows');
  await h.flush();
  const body = strings(find(h.mod.render(), 'factory-workflows'));
  assert.match(body, /Repo[\s\S]*Implement[\s\S]*Build then review[\s\S]*Dev[\s\S]*Review[\s\S]*Base[\s\S]*Implement/);
  assert.equal(find(h.mod.render(), 'factory-file-implement'), undefined);
  click(h, 'factory-folder-repo');
  click(h, 'factory-folder-base');
  await h.flush();
  assert.deepEqual(h.calls.filter((c) => c[0] === 'open'), [['open', '/repo/.herdr-factory'], ['open', '/home/sam/.config/herdr-mods/factory']]);
  assert.doesNotMatch(strings(find(h.mod.render(), 'factory-workflows')), /base:/);
  click(h, 'factory-run-base:implement');
  h.mod.taskBox.set_value('use the base');
  click(h, 'factory-start-send');
  assert.equal(h.ran[0][1].task, '/factory base:implement use the base');
  assert.deepEqual(JSON.parse(JSON.stringify(h.ran[0][1].argv)), ['claude', '--permission-mode', 'auto']);
  h.ran.length = 0;
  h.mod.starting = null;
  click(h, 'factory-tab-workflows');
  click(h, 'factory-run-implement');
  const send = () => find(h.mod.render(), 'factory-start-send');
  assert.equal(send().handlers.click, undefined, 'a task is required');
  h.mod.taskBox.set_value('add a flag');
  click(h, 'factory-start-send');
  assert.deepEqual(JSON.parse(JSON.stringify(h.ran[0])), ['tab.new', { folder: '/repo', argv: ['claude'], task: '/factory implement add a flag' }]);
  assert.equal(h.mod.tab, 'run');
  assert.match(strings(h.mod.render()), /Starting Implement in a new tab/);
  assert.deepEqual(helperCalls(h), [], 'the new session makes the run, not the panel');
  click(h, 'factory-tab-workflows');
  assert.equal(find(h.mod.render(), 'factory-run-implement').handlers.click, undefined, 'no second start while one is on its way');
  h.files['/repo/.herdr-factory/run.json'] = JSON.stringify(RUN([stage({})], { state: 'done' }));
  h.mod.reload(h.cx);
  await h.flush();
  assert.equal(h.mod.render() && h.mod.starting, null);
  assert.ok(find(h.mod.render(), 'factory-run-implement').handlers.click, 'runnable again once its record appears');
});

test('a run working or paused disables Run and says why', async () => {
  for (const state of ['working', 'paused']) {
    const h = await ready({ run: RUN([stage({ state })], { state }), terminals: [session('t1'), session('t9')] });
    click(h, 'factory-tab-workflows');
    await h.flush();
    assert.match(strings(h.mod.render()), /A run is going here/);
    assert.equal(find(h.mod.render(), 'factory-run-implement').handlers.click, undefined);
  }
  const over = await ready({ run: RUN([stage({ state: 'done' })], { state: 'done' }), terminals: [session('t1'), session('t9')] });
  click(over, 'factory-tab-workflows');
  await over.flush();
  click(over, 'factory-run-implement');
  assert.match(strings(find(over.mod.render(), 'factory-start-implement')), /last run's sessions end/);
});

test('a going run stays pinned with past runs below, and a past run opens read-only', async () => {
  const past = { archive: '20260101', orchestrator: 't1', state: 'done', workflow: 'review', started: '2026-01-01T08:00:00', stages: [stage({ id: 'review', state: 'done', terminal: 't9', counts: { low: 1 } })], events: [] };
  const h = await ready({ run: RUN([stage({})]), history: [past], terminals: [session('t1'), session('t9')], results: { '/repo/.herdr-factory/runs/20260101/review-1.json': JSON.stringify({ summary: 'Old', findings: [{ id: 'r1', severity: 'low', title: 'Old finding' }] }) } });
  let tree = h.mod.render();
  assert.ok(find(tree, 'factory-about'));
  assert.ok(find(tree, 'factory-pause'));
  assert.match(strings(find(tree, 'factory-tab-run')), /Runs[\s\S]*2/);
  assert.match(strings(find(tree, 'factory-past-runs')), /Past runs/);
  assert.match(strings(find(tree, 'factory-run-row@20260101')), /Review[\s\S]*Done[\s\S]*Stages 1\/1/);
  assert.equal(find(tree, 'factory-stage-review@20260101'), undefined, 'shut until asked');
  click(h, 'factory-run-row@20260101');
  tree = h.mod.render();
  assert.ok(find(tree, 'factory-stage-review@20260101'));
  assert.equal(find(tree, 'factory-stats@20260101'), undefined, 'its stats are plain text in the row');
  assert.ok(find(tree, 'factory-stage-dev'), 'the pinned run is still there');
  for (const id of ['factory-rerun-review', 'factory-close-review', 'factory-followup-open-review', 'factory-stop-all@20260101', 'factory-close-all@20260101'])
    assert.equal(find(tree, id), undefined, id);
  assert.equal(find(tree, 'factory-stage-review@20260101').handlers.click, undefined, 'its session is not this run\'s to open');
  click(h, 'factory-open-review@20260101');
  await h.flush();
  assert.match(strings(find(h.mod.render(), 'factory-tree')), /Old finding/);
  assert.equal(find(h.mod.render(), 'factory-followup-open-review'), undefined);
});

test('with nothing going, the last run is first and open, with its controls and no pin', async () => {
  const past = { archive: '20260101', state: 'stopped', workflow: 'review', started: '2026-01-01T08:00:00', stages: [stage({ id: 'old', state: 'stopped', terminal: '' })], events: [] };
  const h = await ready({ run: RUN([stage({ state: 'done', terminal: 't9' })], { state: 'done' }), history: [past], terminals: [session('t1'), session('t9')] });
  const tree = h.mod.render();
  assert.equal(find(tree, 'factory-about'), undefined);
  assert.ok(find(tree, 'factory-stage-dev'), 'open');
  assert.ok(find(tree, 'factory-rerun-dev'), 'still has its controls');
  assert.equal(find(tree, 'factory-stage-old@20260101'), undefined, 'older ones start shut');
  click(h, 'factory-run-row');
  assert.equal(find(h.mod.render(), 'factory-stage-dev'), undefined, 'it can be shut');
});

test('two runs with the same stage and attempt keep their own results', async () => {
  const past = { archive: 'old', state: 'done', workflow: 'w', started: '2026-01-01T08:00:00', stages: [stage({ state: 'done', terminal: '' })], events: [] };
  const h = await ready({ run: RUN([stage({ state: 'done', terminal: '' })], { state: 'done' }), history: [past], terminals: [session('t1')], results: {
    '/repo/.herdr-factory/dev-1.json': JSON.stringify({ summary: 'n', replies: { new: 'Current reply' } }),
    '/repo/.herdr-factory/runs/old/dev-1.json': JSON.stringify({ summary: 'o', replies: { old: 'Past reply' } }),
  } });
  click(h, 'factory-open-dev');
  click(h, 'factory-run-row@old');
  click(h, 'factory-open-dev@old');
  await h.flush();
  const body = strings(find(h.mod.render(), 'factory-tree'));
  assert.match(body, /Current reply/);
  assert.match(body, /Past reply/);
});

test('pause and resume are one button that follows the run', async () => {
  const h = await ready({ run: RUN([stage({})]), terminals: [session('t1'), session('t9')] });
  assert.equal(find(h.mod.render(), 'factory-resume'), undefined);
  click(h, 'factory-pause');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['pause']);
  const paused = await ready({ run: RUN([stage({ state: 'paused' })], { state: 'paused' }), terminals: [session('t1'), session('t9')] });
  assert.equal(find(paused.mod.render(), 'factory-pause'), undefined);
  assert.match(strings(find(paused.mod.render(), 'factory-stage-dev')), /Paused/);
  assert.equal(find(paused.mod.render(), 'factory-rerun-dev'), undefined, 'a paused stage has no rerun');
  click(paused, 'factory-resume');
  await paused.flush();
  assert.deepEqual(helperCalls(paused), ['resume']);
  const over = await ready({ run: RUN([stage({ state: 'done' })], { state: 'done' }), terminals: [session('t1')] });
  assert.equal(find(over.mod.render(), 'factory-pause'), undefined);
  assert.equal(find(over.mod.render(), 'factory-resume'), undefined);
});

test('stop all keeps the sessions and close ends them, both asking first and leaving Factory alone', async () => {
  const h = await ready({ run: RUN([stage({})]), terminals: [session('t1'), session('t9')] });
  click(h, 'factory-stop-all');
  assert.deepEqual(helperCalls(h), []);
  assert.match(strings(find(h.mod.render(), 'factory-confirm')), /sessions stay open/);
  click(h, 'factory-confirm-yes');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['stop --keep']);
  click(h, 'factory-close-all');
  assert.match(strings(find(h.mod.render(), 'factory-confirm')), /own session stays/);
  click(h, 'factory-confirm-yes');
  await h.flush();
  assert.deepEqual(helperCalls(h), ['stop --keep', 'stop']);
  const none = await ready({ run: RUN([stage({ state: 'done', terminal: '' })], { state: 'done' }), terminals: [session('t1')] });
  assert.equal(find(none.mod.render(), 'factory-stop-all'), undefined);
  assert.equal(find(none.mod.render(), 'factory-close-all'), undefined);
});

test('names are in title case', async () => {
  const h = await ready({ run: RUN([stage({ id: 'pr-check', after: ['dev'], state: 'queued' })], { workflow: 'pr-review' }), terminals: [session('t1')] });
  assert.match(strings(find(h.mod.render(), 'factory-about')), /Pr Review/);
  assert.match(strings(find(h.mod.render(), 'factory-stage-pr-check')), /Pr Check[\s\S]*After Dev/);
});

test('a reply names its finding in words, even one a later review dropped', async () => {
  const stages = [stage({ state: 'done', replies: 2, attempt: 2 }), stage({ id: 'review', role: 'reviewer', state: 'working', terminal: 't10', attempt: 2 })];
  const h = await ready({ run: RUN(stages), terminals: [session('t1')], results: {
    '/repo/.herdr-factory/dev-2.json': JSON.stringify({ summary: 'Fixed', replies: { r1: 'Bounded it', r9: 'Left it' } }),
    '/repo/.herdr-factory/review-1.json': JSON.stringify({ findings: [{ id: 'r1', severity: 'high', title: 'Retries never stop' }] }),
  } });
  click(h, 'factory-open-dev');
  await h.flush();
  const body = strings(find(h.mod.render(), 'factory-tree'));
  assert.match(body, /Retries never stop Bounded it/);
  assert.match(body, /r9 Left it/);
  assert.doesNotMatch(body, /r1 /);
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
  assert.match(body, /Two problems[\s\S]*High[\s\S]*Drops data[\s\S]*a\.go:3[\s\S]*Why[\s\S]*Low[\s\S]*Naming[\s\S]*Replies[\s\S]*r0 Fixed/);
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
  assert.ok(list.indexOf('Started (attempt 1)') < list.indexOf('Run implement'));
  choose(h, 'factory-events-pick', 'dev');
  list = strings(find(h.mod.render(), 'factory-events'));
  assert.match(list, /implement:dev[\s\S]*Started \(attempt 1\)/);
  assert.doesNotMatch(list, /Run implement/);
  choose(h, 'factory-events-pick', 'run');
  list = strings(find(h.mod.render(), 'factory-events'));
  assert.match(list, /implement[\s\S]*Run implement/);
  assert.doesNotMatch(list, /Started/);
});

test('an event is one paragraph, and an agent\'s words can\'t add markup to it', async () => {
  const events = [{ at: '2026-01-01T15:04:00', text: 'dev done: use <a href="x">this</a> & that', stage: 'dev' }];
  const h = await ready({ run: RUN([stage({})], { events }), terminals: [session('t1')] });
  click(h, 'factory-tab-events');
  const line = strings(find(h.mod.render(), 'factory-events'));
  assert.ok(line.includes('15:04')); assert.ok(line.includes('<code>implement:dev</code> Done: use &lt;a href="x"&gt;this&lt;/a&gt; &amp; that'), line);
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

test('findings leave the stats while a review waits to check again', () => {
  const { context: m } = harness();
  const keys = (r) => [...m.runStats(r)].map((s) => s.key).join();
  assert.equal(keys(RUN([stage({ id: 'review', state: 'queued', counts: { high: 1 }, loop: { with: 'dev', max: 3 }, round: 1 })])), 'stages,round');
  assert.equal(keys(RUN([stage({ id: 'review', state: 'working', counts: { high: 1 } })])), 'stages');
});

test('stats leave out what a run has no use for', async () => {
  const { context: m } = harness();
  const keys = (r) => [...m.runStats(r)].map((s) => s.key).join();
  assert.equal(keys(RUN([stage({})])), 'stages');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: {} })]))[1].tone, 'good');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: { medium: 1 } })]))[1].tone, 'waiting');
  assert.equal(m.runStats(RUN([stage({ state: 'done', counts: { high: 1 } })]))[1].tone, 'danger');
});
