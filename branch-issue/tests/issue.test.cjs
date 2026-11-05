// The panel against stand-ins for Herdr and the helper. Nothing here reaches Linear.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../mods/branch-issue');
const FILES = ['settings.js', 'linear/model.js', 'views/ui.js', 'state/saved.js', 'linear/discovery.js', 'linear/reads.js', 'actions/menus.js', 'actions/agents.js', 'actions/changes.js', 'actions/worktrees.js', 'views/list.js', 'views/detail.js', 'views/comments.js', 'views/worktrees.js', 'main.js'];
const source = FILES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n')
  .replace(/^import\s+[\s\S]*?;$/gm, '')
  .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
  .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { person, who, agentName, slug, folderName });';

function harness({ storage = new Map(), exec, hc, known = [] } = {}) {
  const pending = [], timers = [], after = [], ran = [], sent = [], opened = [];
  const cx = { focus_handle: () => ({ focus() {} }), stop_propagation() {}, notify() {}, open_url: (u) => opened.push(u), write_to_clipboard() {}, spawn(fn) { pending.push(fn(cx)); }, timer: { every(_ms, fn) { timers.push(fn); }, after(_ms, fn) { after.push(fn); } } };
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
          if (k === 'on_key_down') t.handlers.key = a[0];
          if (k === 'on_open_change') t.handlers.open = a[0];
          if (k === 'tooltip') t.tooltip = a[0];
          return proxy;
        };
      },
    });
    return proxy;
  }
  const state = ({ value = '' } = {}) => ({ text: value, value() { return this.text; }, set_value(v) { this.text = v; }, handlers: {}, on(e, f) { this.handlers[e] = f; }, focus() {}, set_selected_range(r) { this.selected = r; } });
  const live = { spaces: [], panes: [], agents: [] };
  const context = {
    View: class {}, div: el, svg: el, v_flex: el, h_flex: el,
    Popover: { new: (id) => el().id(id) }, Input: { new: () => el() }, Textarea: { new: () => el() },
    TextView: { markdown: (_id, text) => el().child(text) },
    InputState: { new: state }, TextareaState: { new: state },
    spaces: () => live.spaces, panes: () => live.panes, agents: () => live.agents,
    exec: exec ?? (async () => ({ code: 1, stdout: '', stderr: '' })),
    hc: hc ?? (async (args) => { sent.push(args); return { code: 0, stdout: '', stderr: '' }; }),
    run: (name, args) => ran.push([name, args]),
    home: () => '/home/sam', appHome: () => '/app', theme: () => new Proxy({}, { get: (_t, k) => `#${String(k)}` }),
    layout: () => live.layout, settings: () => ({ font_family: 'Code' }), readTextFile: async () => null,
    nextCommand: () => new Promise(() => {}), knownAgents: async () => known,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const mod = new context.Mod();
  mod.init({}, cx);
  pending.length = 0;
  mod.sp = { id: 'space', folder: '/repo' }; mod.spaceKey = 'space'; mod.branchLoaded = true; mod.listLoaded = true; mod.me = { id: 'me' };
  return { mod, cx, live, storage, ran, sent, opened, context, tick: () => { for (const fn of timers) fn(cx); }, fireAfter: () => { for (const fn of after.splice(0)) fn(cx); }, flush: async () => { while (pending.length) await Promise.all(pending.splice(0)); } };
}
const settle = () => new Promise(setImmediate);
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const find = (node, id) => (node?.elementId === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const strings = (node) => (typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' '));
const click = (tree, id, h, event = {}) => { const node = find(tree, id); assert.ok(node, `no ${id}`); assert.ok(node.handlers.click, `${id} isn't clickable`); node.handlers.click(event, h.cx); };
const openMenu = (h, id) => find(h.mod.render(), id).handlers.open(true, h.cx);

const STARTED = { id: 'st1', name: 'In Progress', type: 'started', color: '#f2c94c' };
const ISSUE = (over = {}) => ({
  id: 'i1', identifier: 'ENG-1', title: 'Fix the login', url: 'https://linear.app/x/ENG-1', priority: 2, priorityLabel: 'High', updatedAt: new Date().toISOString(), branchName: 'sam/eng-1-fix-login',
  description: 'Why it matters', state: STARTED, assignee: { id: 'u1', name: 'Ann' }, team: { key: 'ENG', name: 'Engineering', states: [STARTED, { id: 'st2', name: 'Done', type: 'completed', color: '#0f0' }], members: [{ id: 'me', name: 'Sam', active: true }, { id: 'u1', name: 'Ann', active: true }] },
  labels: [{ id: 'l1', name: 'bug' }], project: { name: 'Auth' }, cycle: { number: 3 }, estimate: 2, children: [], attachments: [],
  comments: [{ id: 'c1', body: 'First', url: 'https://x/c1', createdAt: '2026-01-01T00:00:00Z', user: { name: 'Bob' } }, { id: 'c2', body: 'A reply', url: 'https://x/c2', createdAt: '2026-01-02T00:00:00Z', user: { name: 'Cam' }, parent: { id: 'c1' } }],
  ...over,
});
const AGENT = (address, over = {}) => ({ address, pane: `p-${address}`, space: 'space', tab_name: `Agent ${address}`, status: 'idle', ...over });
const git = (answers) => async (bin, args) => {
  const line = `${bin} ${args.join(' ')}`;
  for (const [pattern, stdout] of answers) if (line.includes(pattern)) return { code: 0, stdout, stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

// ── What Linear's answers mean ──────────────────────────────────────────────

test('identifiers come from branch names and bindings, uppercased and unique', () => {
  const { context: m } = harness();
  same(m.identifiersIn('sam/eng-123-fix eng-123 OPS-9'), ['ENG-123', 'OPS-9']);
  same(m.identifiersIn('main'), []);
  same(m.identifiersIn('release-2024'), ['RELEASE-2024']);
  same(['7', '#7', 'ab', 'abc', ' ENG-1 '].map(m.searchQuery), ['7', '#7', '', 'abc', 'ENG-1']);
});

test('an issue sums up its sub-issues and PR only when it has them', () => {
  const { context: m } = harness();
  same([...m.issueStats(ISSUE())], []);
  const children = [{ state: { type: 'completed' } }, { state: { type: 'canceled' } }, { state: { type: 'started' } }];
  const pr = { id: 'a', url: 'https://github.com/o/r/pull/12', title: 'Fix', metadata: { status: 'merged' } };
  const stats = [...m.issueStats(ISSUE({ children, attachments: [pr] }))];
  same(stats.map((s) => `${s.label} ${s.value}`), ['Sub-issues 2/3', 'PR Merged']);
  assert.equal(stats[0].tone, 'waiting');
  assert.equal(stats[1].tone, 'good');
});

test('only pull request links count as PRs, with or without a status', () => {
  const { context: m } = harness();
  const prs = [...m.linkedPRs(ISSUE({ attachments: [{ id: 'a', url: 'https://sentry.io/x' }, { id: 'b', url: 'https://github.com/o/r/pull/12' }] }))];
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, '12');
  assert.equal(prs[0].label, 'Linked');
});

test('lists group by state, those being worked on first', () => {
  const { context: m } = harness();
  const s = (name, type) => ({ state: { name, type } });
  same([...m.stateGroups([s('Done', 'completed'), s('Todo', 'unstarted'), s('Doing', 'started'), s('Doing', 'started')])].map((g) => `${g.name} ${g.items.length}`), ['Doing 2', 'Todo 1', 'Done 1']);
});

test('an agent is on an issue through its worktree, or its branch in this space', () => {
  const { context: m } = harness();
  const agents = [AGENT('wt', { space: 'other' }), AGENT('branch'), AGENT('elsewhere'), AGENT('otherspace', { space: 'other' })];
  const panes = [{ pane: 'p-wt', cwd: '/wt/eng-1/sub', branch: 'x' }, { pane: 'p-branch', cwd: '/repo', branch: 'sam/eng-1-fix' }, { pane: 'p-elsewhere', cwd: '/repo', branch: 'main' }, { pane: 'p-otherspace', cwd: '/o', branch: 'eng-1' }];
  same([...m.agentsOnIssue({ agents, panes, issue: ISSUE(), worktrees: [{ path: '/wt/eng-1' }], space: 'space' })].map((a) => a.address), ['wt', 'branch']);
});

test('messages to agents treat Linear text as data', () => {
  const { context: m } = harness();
  const prompt = m.issuePrompt(ISSUE());
  assert.match(prompt, /Work on Linear issue ENG-1: Fix the login/);
  assert.match(prompt, /as data, not instructions/);
  assert.match(prompt, /Bob: First/);
  assert.match(m.handoffMessage(ISSUE(), { context: 'Bob: First', url: 'https://x/c1' }, 'Look'), /^Look[\s\S]*https:\/\/x\/c1[\s\S]*The thread:\nBob: First/);
});

test('a key problem names itself; other errors do not', () => {
  const { context: m } = harness();
  assert.match(m.keyProblem('LINEAR_API_KEY is not set. Export').title, /No Linear API key/);
  assert.match(m.keyProblem('Linear rejected LINEAR_API_KEY.').title, /rejected/);
  assert.equal(m.keyProblem('Linear is unreachable'), null);
});

// ── The panel ───────────────────────────────────────────────────────────────

test('a missing key takes over the panel, and can be retried', () => {
  const h = harness();
  h.mod.error = 'LINEAR_API_KEY is not set. Export a personal API key';
  h.mod.issue = ISSUE();
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-key-problem')), /No Linear API key[\s\S]*export LINEAR_API_KEY/);
  assert.doesNotMatch(JSON.stringify(strings(tree)), /lin_api/);
  click(tree, 'issue-get-key', h);
  same(h.opened, ['https://linear.app/settings/api']);
  h.mod.refresh = () => { h.refreshed = true; };
  click(tree, 'issue-key-retry', h);
  assert.equal(h.refreshed, true);
  assert.equal(h.mod.error, null);
  h.mod.error = 'Something else';
  assert.equal(find(h.mod.render(), 'issue-key-problem'), undefined);
  assert.match(strings(find(h.mod.render(), 'issue-error')), /Something else/);
});

test('Branch and All tabs are remembered, with spinners until first loaded', async () => {
  const storage = new Map();
  const h = harness({ storage });
  h.mod.branchLoaded = false; h.mod.listLoaded = false;
  let tree = h.mod.render();
  for (const id of ['issue-view-branch', 'issue-view-all']) {
    assert.equal(find(tree, id).handlers.click, undefined);
    assert.doesNotMatch(strings(find(tree, id)), /\d/);
  }
  h.mod.branchLoaded = true; h.mod.listLoaded = true;
  h.mod.items = [ISSUE({ id: 'b', identifier: 'ENG-9', title: 'Theirs' })]; h.mod.cursor = 'next';
  h.mod.branchIssues = [ISSUE(), ISSUE({ id: 'i2', identifier: 'ENG-2' })];
  tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-view-branch')), /Branch 2/);
  assert.match(strings(find(tree, 'issue-view-all')), /All 1\+/);
  assert.ok(find(tree, 'issue-i1')); assert.equal(find(tree, 'issue-b'), undefined);
  click(tree, 'issue-view-all', h);
  tree = h.mod.render();
  assert.ok(find(tree, 'issue-b')); assert.equal(find(tree, 'issue-i1'), undefined);
  assert.ok(find(tree, 'issue-filter-row'));
  assert.equal(storage.get('view'), 'all');
  assert.equal(harness({ storage }).mod.view, 'all');
  assert.equal(h.ran.length, 0, 'nothing opens a tab');
});

test('a branch with one issue shows it straight away, with no back button', async () => {
  const h = harness({ exec: git([['symbolic-ref', 'sam/eng-1-fix\n']]) });
  h.mod.api = async (r) => (r.action === 'resolve' ? { items: [ISSUE()] } : ISSUE());
  h.mod.loadBranchIssues(h.cx); await h.flush();
  assert.equal(h.mod.issue.identifier, 'ENG-1');
  let tree = h.mod.render();
  assert.equal(find(tree, 'issue-back'), undefined);
  assert.ok(find(tree, 'issue-actions'));
  click(tree, 'issue-view-all', h); await h.flush();
  assert.equal(h.mod.issue, null);
  click(h.mod.render(), 'issue-view-branch', h); await h.flush();
  assert.equal(h.mod.issue.identifier, 'ENG-1', 'coming back opens it again');
  h.mod.branchIssues = [ISSUE(), ISSUE({ id: 'i2', identifier: 'ENG-2' })];
  assert.ok(find(h.mod.render(), 'issue-back'), 'a second brings back the list');
});

test('an issue opens like a commit: tabs stay, a busy view shows, and back cancels', async () => {
  const h = harness();
  h.mod.branchIssues = [ISSUE(), ISSUE({ id: 'i2', identifier: 'ENG-2' })];
  let finish;
  h.mod.api = () => new Promise((done) => { finish = () => done(ISSUE()); });
  click(h.mod.render(), 'issue-i1', h);
  await settle();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-busy')), /Loading ENG-1/);
  assert.ok(find(tree, 'issue-view-branch'));
  click(tree, 'issue-back', h);
  finish(); await h.flush();
  assert.equal(h.mod.issue, null, 'going back cancelled it');
  click(h.mod.render(), 'issue-i1', h);
  await settle();
  finish(); await h.flush();
  tree = h.mod.render();
  assert.equal(find(tree, 'issue-busy'), undefined);
  assert.equal(tree.nodes[1].elementId, 'issue-about');
  const about = tree.nodes[1];
  assert.match(strings(about.nodes[0]), /Fix the login[\s\S]*ENG-1/);
  assert.ok(find(about.nodes[0], 'issue-open-linear'));
  assert.ok(find(about.nodes[1], 'issue-actions'));
  const strip = find(tree, 'issue-stats');
  assert.ok(find(strip, 'issue-state-pick') && find(strip, 'issue-priority-pick') && find(strip, 'issue-assignee-pick'));
  assert.doesNotMatch(strings(strip), /Comments/);
  click(tree, 'issue-open-linear', h);
  same(h.opened, ['https://linear.app/x/ENG-1']);
});

test('state, priority and assignee write when chosen and merge the answer', async () => {
  const h = harness();
  h.mod.issue = ISSUE();
  h.mod.branchIssues = [h.mod.issue, ISSUE({ id: 'i2' })];
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return { issueUpdate: { issue: { id: 'i1', state: { id: 'st2', name: 'Done', type: 'completed' } } } }; };
  openMenu(h, 'issue-state-pick');
  click(h.mod.render(), 'issue-state-pick-option-st2', h); await h.flush();
  assert.equal(asked[0].action, 'update'); assert.equal(asked[0].stateId, 'st2');
  assert.equal(h.mod.issue.state.name, 'Done');
  assert.equal(h.mod.notice, 'State saved to Linear.');
  openMenu(h, 'issue-priority-pick');
  click(h.mod.render(), 'issue-priority-pick-option-1', h); await h.flush();
  assert.equal(asked[1].priority, 1);
  openMenu(h, 'issue-assignee-pick');
  click(h.mod.render(), 'issue-assignee-pick-option-none', h); await h.flush();
  assert.equal(asked[2].unassign, true);
  openMenu(h, 'issue-assignee-pick');
  click(h.mod.render(), 'issue-assignee-pick-option-me', h); await h.flush();
  assert.equal(asked[3].assignee, 'me');
});

test('labels show but cannot be edited, and groups collapse and stay that way', () => {
  const storage = new Map();
  const h = harness({ storage });
  h.mod.issue = ISSUE();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-prop-labels')), /bug/);
  assert.ok(find(tree, 'issue-prop-project'));
  click(tree, 'issue-group-properties', h);
  tree = h.mod.render();
  assert.equal(find(tree, 'issue-prop-project'), undefined);
  const again = harness({ storage });
  again.mod.issue = ISSUE();
  assert.equal(find(again.mod.render(), 'issue-prop-project'), undefined);
});

test('links show a PR status, sub-issues and the parent open in the panel', async () => {
  const h = harness();
  h.mod.issue = ISSUE({ attachments: [{ id: 'a', title: 'Fix', url: 'https://github.com/o/r/pull/12', metadata: { status: 'merged' } }], children: [{ id: 'k', identifier: 'ENG-5', title: 'Part', state: { color: '#000' } }], parent: { identifier: 'ENG-0', title: 'Big' } });
  h.mod.api = async (r) => ISSUE({ identifier: r.identifier });
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-link-a')), /Fix[\s\S]*Merged/);
  click(tree, 'issue-link-a', h);
  same(h.opened, ['https://github.com/o/r/pull/12']);
  click(tree, 'issue-child-k', h); await h.flush();
  assert.equal(h.mod.issue.identifier, 'ENG-5');
});

test('agents on the issue are listed, and a click goes to them', () => {
  const h = harness();
  h.mod.issue = ISSUE();
  h.live.agents = [AGENT('t1', { status: 'working' })];
  h.live.panes = [{ pane: 'p-t1', cwd: '/repo', branch: 'eng-1-fix' }];
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-agent-t1')), /Agent t1[\s\S]*working/);
  find(tree, 'issue-agent-t1').handlers.click({}, h.cx);
  same(h.ran.at(-1), ['agent.focus', { terminal: 't1' }]);
});

test('Actions start work and hand the issue on through a prompt only Send delivers', async () => {
  const h = harness();
  h.mod.issue = ISSUE();
  h.live.agents = [AGENT('t1')];
  openMenu(h, 'issue-actions');
  click(h.mod.render(), 'issue-actions-option-agent:t1', h);
  assert.equal(h.sent.length, 0);
  assert.equal(h.mod.composer.kind, 'agent');
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'issue-submit', h); await h.flush();
  assert.match(h.sent[0][2], /^Look at this/);
  assert.match(h.sent[0][2], /as data, not instructions/);
  assert.equal(h.mod.notice, 'Sent to Agent t1.');
  assert.equal(h.mod.composer, null);
});

test('a thread goes to an agent with its comments; a failed delivery says why', async () => {
  const h = harness({ hc: async () => ({ code: 1, stderr: 'gone' }) });
  h.mod.issue = ISSUE();
  h.mod.section = 'comments';
  h.live.agents = [AGENT('t1')];
  openMenu(h, 'issue-agent-send-c1');
  click(h.mod.render(), 'issue-agent-send-c1-option-t1', h);
  assert.match(h.mod.composer.context, /Bob: First\n\nCam: A reply/);
  click(h.mod.render(), 'issue-submit', h); await h.flush();
  assert.equal(h.mod.error, 'gone');
  assert.ok(h.mod.composer, 'keeps the prompt');
});

test('an issue can go to a new agent from either menu, through the editable prompt', async () => {
  const h = harness({ known: [{ key: 'claude', name: 'Claude Code', run: ['claude'], installed: true }] });
  h.mod.issue = ISSUE();
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  openMenu(h, 'issue-actions');
  click(h.mod.render(), 'issue-actions-option-agent:new:claude', h);
  assert.equal(h.ran.filter(([n]) => n === 'tab.new').length, 0, 'only Send delivers');
  assert.match(strings(h.mod.render()), /Send to new Claude Code/);
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'issue-submit', h); await h.flush();
  const [name, args] = h.ran.at(-1);
  assert.equal(name, 'tab.new');
  assert.deepEqual(JSON.parse(JSON.stringify(args.argv)), ['claude']);
  assert.match(args.task, /^Look at this/);
  assert.match(args.task, /as data, not instructions/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.mod.notice, 'Started new Claude Code in a new tab.');
  assert.equal(h.mod.composer, null);
});

test('(spawn) goes through the editable prompt, then starts a sub-agent with no shell', async () => {
  const h = harness({ known: [{ key: 'claude', name: 'Claude Code', run: ['claude'], installed: true }] });
  h.mod.issue = ISSUE();
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  h.live.agents = [AGENT('t1', { status: 'working', program: { key: 'claude' } })];
  openMenu(h, 'issue-actions');
  click(h.mod.render(), 'issue-actions-option-agent:spawn:t1', h);
  assert.equal(h.sent.length, 0);
  const box = strings(h.mod.render());
  assert.match(box, /Send to Agent t1 \(spawn\)/);
  assert.doesNotMatch(box, /busy/, 'a busy parent does not hold up a sub-agent');
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'issue-submit', h); await h.flush();
  assert.deepEqual([...h.sent[0]].slice(0, 7), ['run', '--bg', '--json', '--parent', 't1', '--cwd', '/repo']);
  assert.equal(h.sent[0][7], 'claude');
  assert.match(h.sent[0][8], /^Look at this/);
  assert.equal(h.mod.notice, 'Started a sub-agent under Agent t1.');
});

test('without an agent the handoff says so', () => {
  const h = harness();
  h.mod.issue = ISSUE();
  h.mod.section = 'comments';
  const send = find(h.mod.render(), 'issue-agent-send-c1');
  assert.match(strings(send), /no agent/);
  assert.equal(send.handlers.click, undefined);
});

test('a failed post keeps the draft; a good one clears it, and replies go in their thread', async () => {
  const h = harness();
  h.mod.issue = ISSUE();
  h.mod.section = 'comments';
  click(h.mod.render(), 'issue-reply-c1', h);
  h.mod.editor.set_value('Keep this');
  h.storage.set(h.mod.draftKey, 'Keep this');
  const draft = h.mod.draftKey;
  h.mod.api = async () => { throw Error('offline'); };
  h.mod.mutate(h.cx); await h.flush();
  assert.equal(h.mod.editor.value(), 'Keep this');
  assert.match(h.mod.error, /offline/);
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return r.action === 'detail' ? ISSUE() : {}; };
  h.mod.mutate(h.cx); await h.flush();
  assert.equal(asked[0].parent, 'c1');
  assert.equal(h.mod.composer, null);
  assert.equal(h.storage.has(draft), false);
});

test('a new comment is written after the last one, and its draft stays with the issue', async () => {
  const h = harness();
  h.mod.adoptIssue(ISSUE());
  h.mod.section = 'comments';
  let tree = h.mod.render();
  assert.ok(find(tree, 'issue-new-comment'));
  assert.equal(find(tree, 'issue-add-comment').handlers.click, undefined, 'nothing to post yet');
  h.mod.newComment.set_value('Hello');
  h.storage.set(h.mod.commentKey, 'Hello');
  h.mod.backToList(h.cx);
  h.mod.adoptIssue(ISSUE());
  assert.equal(h.mod.newComment.value(), 'Hello');
  h.mod.api = async () => { throw Error('offline'); };
  click(h.mod.render(), 'issue-add-comment', h); await h.flush();
  assert.equal(h.mod.newComment.value(), 'Hello', 'a failed post keeps it');
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return r.action === 'detail' ? ISSUE() : {}; };
  click(h.mod.render(), 'issue-add-comment', h); await h.flush();
  assert.equal(asked[0].body, 'Hello');
  assert.equal(asked[0].parent, '');
  assert.equal(h.mod.newComment.value(), '');
  assert.equal(h.storage.has(h.mod.commentKey), false);
});

test('an empty branch offers a link that Linear confirms before Git is written', async () => {
  const log = [];
  const h = harness({ exec: async (bin, args) => { log.push(args.join(' ')); if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'main\n' }; if (args.includes('--get')) return { code: 1, stdout: '' }; return { code: 0, stdout: '' }; } });
  h.mod.branch = 'main';
  h.mod.api = async (r) => { if (r.action === 'detail') throw Error('ENG-9 was not found in Linear'); return { items: [] }; };
  assert.match(strings(h.mod.render()), /No issue found for main/);
  h.mod.linkInput.set_value('eng-9');
  h.mod.linkIssue(h.cx); await h.flush();
  assert.match(h.mod.error, /not found/);
  assert.equal(log.some((l) => /^config branch\.main\.herdr-issue ENG-9$/.test(l)), false);
  h.mod.api = async (r) => (r.action === 'detail' ? ISSUE() : { items: [ISSUE()] });
  h.mod.linkIssue(h.cx); await h.flush();
  assert.ok(log.some((l) => /^config branch\.main\.herdr-issue ENG-9$/.test(l)));
});

test('only a hand-made link offers Unlink, and it removes just that one', async () => {
  const log = [];
  const h = harness({ exec: async (bin, args) => { log.push(args.join(' ')); if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'main\n' }; if (args.includes('--get')) return { code: 0, stdout: 'ENG-1,ENG-2' }; return { code: 0, stdout: '' }; } });
  h.mod.branch = 'main';
  h.mod.issue = ISSUE();
  openMenu(h, 'issue-actions');
  assert.equal(find(h.mod.render(), 'issue-actions-option-unlink'), undefined);
  h.mod.linkedIdentifiers = new Set(['ENG-1']);
  h.mod.api = async () => ({ items: [] });
  click(h.mod.render(), 'issue-actions-option-unlink', h); await h.flush();
  assert.ok(log.some((l) => l === 'config branch.main.herdr-issue ENG-2'));
});

test('the list sends its filters, groups by state and offers more', async () => {
  const h = harness();
  h.mod.view = 'all';
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return { items: [ISSUE({ id: `n${asked.length}` })], cursor: asked.length === 1 ? 'c' : '' }; };
  h.mod.scope = 'cycle'; h.mod.state = 'started'; h.mod.team = 'ENG';
  h.mod.loadList(h.cx); await h.flush();
  assert.equal(asked[0].scope, 'cycle'); assert.equal(asked[0].state, 'started'); assert.equal(asked[0].team, 'ENG');
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-group-In Progress')), /In Progress\s+1/);
  click(tree, 'issue-more', h); await h.flush();
  assert.equal(asked[1].cursor, 'c');
  assert.equal(h.mod.items.length, 2);
  assert.equal(find(h.mod.render(), 'issue-more'), undefined);
});

test('search waits for typing to stop, and numbers count', async () => {
  const h = harness();
  const asked = [];
  h.mod.api = async (r) => { asked.push(r.search); return { items: [], cursor: '' }; };
  h.mod.search.set_value('ab'); h.mod.search.handlers.change({}, h.cx); h.fireAfter(); await h.flush();
  same(asked, []);
  h.mod.search.set_value('12'); h.mod.search.handlers.change({}, h.cx); h.fireAfter(); await h.flush();
  same(asked, ['12']);
});

test('a stale list answer does not replace another space', async () => {
  const h = harness();
  let finish;
  h.mod.api = () => new Promise((r) => { finish = r; });
  h.mod.loadList(h.cx);
  await settle();
  h.mod.changeSpace(null, 'other', h.cx);
  finish({ items: [ISSUE()], cursor: '' }); await h.flush();
  assert.equal(h.mod.items.length, 0);
});

test('refreshing waits while hidden, and a load that never answers cannot lock the tabs', () => {
  const h = harness();
  const { context: m } = h;
  const panel = (active) => ({ type: 'row', children: [{ id: 'body', type: 'stack', active, children: [{ id: 'files', content: { mod: 'files' } }, { id: 'i', content: { mod: 'branch-issue' } }] }] });
  assert.equal(m.panelShown(panel('i'), 'branch-issue'), true);
  assert.equal(m.panelShown(panel('files'), 'branch-issue'), false);
  h.mod.spaceKey = '';
  h.mod.listLoaded = false; h.mod.branchLoaded = false;
  h.mod.contextSince = Date.now() - 31000;
  h.tick();
  assert.equal(h.mod.listLoaded, true);
  assert.equal(h.mod.branchLoaded, true);
});

test('a reload reopens the saved issue once, and settings problems show', async () => {
  const storage = new Map();
  const first = harness({ storage });
  first.mod.adoptIssue(ISSUE());
  first.mod.scope = 'cycle';
  first.mod.rememberView();
  const second = harness({ storage });
  second.mod.restoreView();
  assert.equal(second.mod.scope, 'cycle');
  assert.equal(second.mod.restoreSelection, 'ENG-1');
  const asked = [];
  second.mod.api = async (r) => { asked.push(r.action); return r.action === 'detail' ? ISSUE() : { items: [], cursor: '' }; };
  second.mod.loadList(second.cx); await second.flush();
  assert.equal(second.mod.issue.identifier, 'ENG-1');
  second.mod.backToList(second.cx);
  second.mod.restoreSelection = 'ENG-1';
  second.mod.loadList(second.cx); await second.flush();
  assert.equal(second.mod.issue, null, 'only once');
  second.mod.settingsProblems = ['refresh.every: wrong type'];
  assert.match(strings(find(second.mod.render(), 'issue-settings-problems')), /wrong type/);
});

// ── Start work ──────────────────────────────────────────────────────────────

const gitRepo = (log, over = {}) => async (bin, args) => {
  const line = `${bin} ${args.join(' ')}`;
  log.push(line);
  if (line.includes('check-ref-format')) return { code: 0, stdout: `${args.at(-1)}\n` };
  if (line.includes('show-ref')) return { code: 1, stdout: '' };
  if (line.includes('symbolic-ref')) return { code: 0, stdout: 'origin/main\n' };
  if (line.includes('--get-regexp') || line.includes('worktree list')) return { code: 1, stdout: '' };
  return over[args[0]] ?? { code: 0, stdout: '' };
};

test('Start work uses Linear\'s branch name and opens a space, the agent getting the issue', async () => {
  const log = [];
  const h = harness({ exec: gitRepo(log), known: [{ key: 'claude', name: 'Claude', installed: true, run: ['claude'] }] });
  h.mod.issue = ISSUE();
  h.mod.api = async () => ISSUE();
  openMenu(h, 'issue-actions');
  click(h.mod.render(), 'issue-actions-option-start', h); await h.flush();
  const form = h.mod.worktreeForm;
  assert.equal(form.branch.value(), 'sam/eng-1-fix-login');
  assert.equal(form.base.value(), 'main');
  form.launch = 'claude';
  assert.ok(find(h.mod.render(), 'issue-worktree-form'));
  click(h.mod.render(), 'issue-worktree-submit', h); await h.flush();
  assert.ok(log.some((l) => l.includes('fetch --no-tags origin main')));
  assert.ok(log.some((l) => l.includes('worktree add -b sam/eng-1-fix-login -- /home/sam/.herdr/worktrees/repo/sam-eng-1-fix-login FETCH_HEAD')));
  assert.ok(log.some((l) => l.includes('config branch.sam/eng-1-fix-login.herdr-issue ENG-1')));
  const [name, args] = h.ran.at(-1);
  assert.equal(name, 'space.new');
  assert.equal(args.argv[0], 'claude');
  assert.match(args.argv[1], /Work on Linear issue ENG-1/);
  assert.equal(h.mod.worktreeForm, null);
});

test('Start work can move the issue to Started, and refuses bad names and existing branches', async () => {
  const log = [];
  const h = harness({ exec: gitRepo(log) });
  h.mod.issue = ISSUE({ state: { id: 'todo', name: 'Todo', type: 'unstarted' } });
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return ISSUE(); };
  h.mod.showWorktree(h.cx); await h.flush();
  const form = h.mod.worktreeForm;
  form.name.set_value('../evil');
  h.mod.createWorktree(h.cx); await h.flush();
  assert.match(form.error, /letters, numbers/);
  assert.equal(log.some((l) => l.includes('worktree add')), false);
  form.name.set_value('ok');
  form.start = true;
  h.mod.createWorktree(h.cx); await h.flush();
  assert.ok(asked.some((r) => r.action === 'update' && r.stateId === 'st1'));
  const exists = harness({ exec: async (bin, args) => (args.includes('show-ref') ? { code: 0, stdout: '' } : args.includes('check-ref-format') ? { code: 0, stdout: 'b\n' } : { code: 1, stdout: '' }) });
  exists.mod.issue = ISSUE({ branchName: 'b' });
  exists.mod.showWorktree(exists.cx); await exists.flush();
  exists.mod.createWorktree(exists.cx); await exists.flush();
  assert.match(exists.mod.worktreeForm.error, /already exists/);
});

test('an issue\'s worktrees are listed, and a click switches to or opens their space', async () => {
  const h = harness({ exec: git([['--get-regexp', 'branch.fix.herdr-issue ENG-1\n'], ['worktree list', 'worktree /wt/eng\nHEAD a\nbranch refs/heads/fix\n\n']]) });
  h.mod.issue = ISSUE();
  h.mod.loadWorktrees(h.cx); await h.flush();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'issue-worktree-row-0')), /eng\s+fix/);
  find(tree, 'issue-worktree-row-0').handlers.click({}, h.cx);
  assert.equal(h.ran.at(-1)[0], 'space.new');
  h.live.spaces = [{ id: 'wt', folder: '/wt/eng' }];
  h.mod.spaceKey = 'space';
  tree = h.mod.render();
  find(tree, 'issue-worktree-row-0').handlers.click({}, h.cx);
  same(h.ran.at(-1), ['space.select', { id: 'wt' }]);
});

test('nothing left of the center tab, label editing or comment editing', () => {
  assert.doesNotMatch(source, /tab\.new[^;]*mod:|openBrowser|labelIds|edit-comment|"browser"|typography/);
});

test('a handoff asks only for what the prompt says, while Start work asks for the work', () => {
  const { context: m } = harness();
  assert.match(m.issuePrompt(ISSUE()), /^Work on Linear issue/);
  assert.doesNotMatch(m.handoffMessage(ISSUE(), {}, 'Just analyze this'), /Work on/);
});

test('a confirmation leaves after a few seconds', () => {
  const h = harness();
  h.tick(); // settles on the space first, which clears any notice
  h.mod.notice = 'Saved to Linear.';
  h.tick();
  assert.equal(h.mod.notice, 'Saved to Linear.');
  h.mod.noticeSince = Date.now() - 6000;
  h.tick();
  assert.equal(h.mod.notice, null);
});

test('the state chooser follows the workflow, not the order Linear returns', () => {
  const { context: m } = harness();
  const names = (list) => m.workflowOrder(list).map((s) => s.name);
  same(names([{ name: 'Canceled', type: 'canceled' }, { name: 'Backlog', type: 'backlog' }, { name: 'In Progress', type: 'started' }, { name: 'Duplicate', type: 'canceled' }, { name: 'Done', type: 'completed' }, { name: 'Todo', type: 'unstarted' }]), ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled', 'Duplicate']);
});
