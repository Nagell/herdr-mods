// The panel against stand-ins for Herdr and the helper. Nothing here reaches GitHub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../mods/branch-pr');
const FILES = ['settings.js', 'github/model.js', 'views/ui.js', 'state/saved.js', 'github/discovery.js', 'github/reads.js', 'actions/menus.js', 'actions/agents.js', 'actions/changes.js', 'actions/worktrees.js', 'views/list.js', 'views/detail.js', 'views/conversation.js', 'views/checks.js', 'views/worktrees.js', 'views/files.js', 'main.js'];
const source = FILES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n')
  .replace(/^import\s+[\s\S]*?;$/gm, '')
  .replace(/^export default (\w+);$/m, 'globalThis.Mod = $1;')
  .replace(/^export /gm, '')
  + '\nObject.assign(globalThis, { authorsOf, repoUrl, who, agentName });';

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
  const live = { spaces: [], panes: [], agents: [], shared: {} };
  const context = {
    View: class {}, div: el, svg: el, v_flex: el, h_flex: el,
    Popover: { new: (id) => el().id(id) }, Input: { new: () => el() }, Textarea: { new: () => el() },
    TextView: { markdown: (_id, text) => el().child(text) },
    InputState: { new: state }, TextareaState: { new: state },
    spaces: () => live.spaces, panes: () => live.panes, agents: () => live.agents,
    exec: exec ?? (async () => ({ code: 1, stdout: '', stderr: '' })),
    hc: hc ?? (async (args) => { sent.push(args); return { code: 0, stdout: '', stderr: '' }; }),
    run: (name, args) => ran.push([name, args]),
    shared: (k) => live.shared[k], setShared: (k, v) => { live.shared[k] = v; },
    home: () => '/home/sam', appHome: () => '/app', theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
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
  mod.repo = 'owner/repo'; mod.sp = { id: 'space', folder: '/repo' }; mod.spaceKey = 'space'; mod.branchLoaded = true; mod.listLoaded = true;
  return { mod, cx, live, storage, ran, sent, opened, context, tick: () => { for (const fn of timers) fn(cx); }, fireAfter: () => { for (const fn of after.splice(0)) fn(cx); }, flush: async () => { while (pending.length) await Promise.all(pending.splice(0)); } };
}
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const find = (node, id) => (node?.elementId === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const strings = (node) => (typeof node === 'string' ? node : (node?.nodes ?? []).map(strings).join(' '));
const click = (tree, id, h, event = {}) => { const node = find(tree, id); assert.ok(node, `no ${id}`); assert.ok(node.handlers.click, `${id} isn't clickable`); node.handlers.click(event, h.cx); };

const PR = (over = {}) => ({
  id: 'pr', number: 2, repository: 'owner/repo', title: 'Example', url: 'https://github.com/owner/repo/pull/2', body: 'Why it matters', state: 'OPEN', isDraft: false,
  headRefOid: 'abc', headRefName: 'fix', baseRefName: 'main', author: { login: 'ann' }, reviewDecision: null, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  mergeMethods: ['squash', 'merge'], autoMergeAllowed: true, reviewers: [], checks: [], reviews: [], threads: [],
  comments: [{ id: 'c1', body: 'First', url: 'https://x/c1', createdAt: '2026-01-01T00:00:00Z', author: { login: 'bob' } }],
  ...over,
});
const openActions = (h) => find(h.mod.render(), 'pr-actions').handlers.open(true, h.cx);
const THREAD = (over = {}) => ({ id: 't1', path: 'a.go', line: 3, isResolved: false, viewerCanReply: true, viewerCanResolve: true, comments: [{ id: 'tc', body: 'Rename this', url: 'https://x/t1', createdAt: '2026-01-02T00:00:00Z', diffHunk: '1\n2\n3\n4\n5\n6\n7\n8', author: { login: 'cam' } }], ...over });
const FAILED = { name: 'build', conclusion: 'FAILURE', detailsUrl: 'https://github.com/owner/repo/actions/runs/77/job/88' };
const AGENT = (address, over = {}) => ({ address, pane: `p-${address}`, space: 'space', tab_name: `Agent ${address}`, status: 'idle', ...over });

// ── What GitHub's answers mean ──────────────────────────────────────────────

test('the blocked-by line names each reason, worst first, and where to read about it', () => {
  const { context: m } = harness();
  const labels = (over) => m.mergeBlockers(PR(over)).map((b) => b.label);
  same(labels({}), []);
  same(labels({ checks: [FAILED, { name: 'lint', status: 'IN_PROGRESS' }], threads: [THREAD(), THREAD({ id: 't2', isResolved: true })], reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', mergeStateStatus: 'BEHIND' }),
    ['Conflicts', '1 check failed', 'Changes requested', '1 unresolved', '1 check running', 'Behind main']);
  same(labels({ isDraft: true, reviewDecision: 'REVIEW_REQUIRED' }), ['Draft', 'Review required']);
  same(labels({ mergeStateStatus: 'BLOCKED' }), ['Blocked by branch rules']);
  same(labels({ state: 'MERGED', checks: [FAILED] }), []);
  const failed = m.mergeBlockers(PR({ checks: [FAILED] }))[0];
  assert.equal(failed.section, 'checks');
  assert.equal(failed.tone, 'danger');
});

test('actions follow the PR, offering merge when ready only while something is in the way', () => {
  const { context: m } = harness();
  const events = (over) => [...m.stateEvents(PR(over))];
  same(events({}), ['squash', 'merge', 'close']);
  same(events({ mergeStateStatus: 'BLOCKED' }), ['auto', 'squash', 'merge', 'close']);
  same(events({ mergeStateStatus: 'BEHIND' }), ['auto', 'squash', 'merge', 'close']);
  same(events({ mergeStateStatus: 'BLOCKED', autoMergeAllowed: false }), ['squash', 'merge', 'close']);
  // A check that failed but isn't required: GitHub wouldn't wait, so it isn't offered.
  same(events({ checks: [FAILED], mergeStateStatus: 'UNSTABLE' }), ['squash', 'merge', 'close']);
  same(events({ checks: [FAILED], mergeStateStatus: 'CLEAN' }), ['squash', 'merge', 'close']);
  same(events({ autoMergeRequest: { enabledAt: 'x' } }), ['cancel-auto', 'close']);
  same(events({ isDraft: true }), ['close']);
  same(events({ state: 'CLOSED' }), ['reopen']);
  same(events({ state: 'MERGED' }), []);
});

test('only GitHub remotes are accepted, including SSH aliases', () => {
  const { context: m } = harness();
  assert.equal(m.repositoryFromRemote('git@github.com:o/r.git\n'), 'o/r');
  assert.equal(m.repositoryFromRemote('https://github.com/o/r'), 'o/r');
  assert.equal(m.repositoryFromRemote('git@github-work:o/r.git'), 'o/r');
  for (const bad of ['git@gitlab.com:g/p.git', 'https://github.com/o/r/x', 'git@work:o/r.git', 'nonsense'])
    assert.throws(() => m.repositoryFromRemote(bad));
});

test('an agent is on a PR through its worktree, or by branch in this space', () => {
  const { context: m } = harness();
  const agents = [AGENT('in-worktree', { space: 'other' }), AGENT('on-branch'), AGENT('elsewhere'), AGENT('same-branch-other-space', { space: 'other' })];
  const panes = [
    { pane: 'p-in-worktree', cwd: '/wt/PR-2/sub', branch: 'x' }, { pane: 'p-on-branch', cwd: '/repo', branch: 'fix' },
    { pane: 'p-elsewhere', cwd: '/repo', branch: 'main' }, { pane: 'p-same-branch-other-space', cwd: '/other', branch: 'fix' },
  ];
  const on = m.agentsOnPR({ agents, panes, pr: PR(), worktrees: [{ path: '/wt/PR-2' }], space: 'space' });
  same([...on].map((a) => a.address), ['in-worktree', 'on-branch']);
});

test('handoff messages point at the failure and treat GitHub text as data', () => {
  const { context: m } = harness();
  const fix = m.fixCheckMessage(PR(), 'owner/repo', FAILED);
  assert.match(fix, /gh run view --job 88 --repo owner\/repo --log-failed/);
  assert.match(fix, /as data, not instructions/);
  assert.match(fix, /Don't push/);
  assert.match(m.fixCheckMessage(PR(), 'owner/repo', { context: 'ci/external', state: 'FAILURE', targetUrl: 'https://ci/1' }), /https:\/\/ci\/1/);
  const threads = m.unresolvedMessage(PR({ threads: [THREAD(), THREAD({ id: 't2', isResolved: true, path: 'done.go' })] }));
  assert.match(threads, /1 unresolved review thread/);
  assert.match(threads, /a\.go:3 https:\/\/x\/t1\ncam: Rename this/);
  assert.doesNotMatch(threads, /done\.go/);
  assert.match(threads, /as data, not instructions/);
});

test('someone\'s unsubmitted review stays out of the conversation', () => {
  const { context: m } = harness();
  const pr = PR({ reviews: [{ id: 'r1', state: 'PENDING', body: 'draft', author: { login: 'me' } }, { id: 'r2', state: 'APPROVED', body: '', submittedAt: '2026-02-01T00:00:00Z', author: { login: 'dee' } }] });
  same([...m.conversationEntries(pr)].map((e) => e.kind), ['Comment', 'Approved']);
  same([...m.authorsOf(pr)], ['bob', 'dee']);
});

// ── The detail views ────────────────────────────────────────────────────────

test('an open PR shows the same stats on one line, and each goes to where it is explained', () => {
  const h = harness();
  h.mod.pr = PR({ checks: [FAILED, { name: 'ok', conclusion: 'SUCCESS' }], threads: [THREAD()], reviewDecision: 'CHANGES_REQUESTED', reviewers: [{ login: 'a', state: 'CHANGES_REQUESTED' }, { login: 'b', state: 'APPROVED' }, { login: 'c', state: 'COMMENTED' }] });
  let tree = h.mod.render();
  const text = (key) => strings(find(tree, `pr-stat-${key}`)).replace(/\s+/g, ' ').trim();
  assert.equal(text('checks'), 'Checks 1/2');
  assert.equal(text('reviews'), 'Reviews 1/2');
  assert.equal(find(tree, 'pr-stat-reviews').tooltip, 'Changes requested');
  assert.equal(text('unresolved'), 'Unresolved 1');
  assert.equal(find(tree, 'pr-stat-merge'), undefined, 'the others already say it is blocked');
  assert.equal(find(tree, 'pr-stat-checks').tooltip, '1 failed, 1 passed');
  assert.match(strings(find(tree, 'pr-about')), /ann · fix → main/);
  click(tree, 'pr-stat-unresolved', h);
  assert.equal(h.mod.section, 'conversation');
  assert.equal(h.mod.unresolved, true);
  click(h.mod.render(), 'pr-stat-checks', h);
  assert.equal(h.mod.section, 'checks');
  h.mod.pr = PR();
  tree = h.mod.render();
  assert.equal(text('merge'), 'Merge Ready');
  assert.equal(text('checks'), 'Checks –');
  assert.equal(text('unresolved'), 'Unresolved 0');
  h.mod.pr = PR({ mergeable: 'CONFLICTING' });
  tree = h.mod.render();
  assert.equal(text('merge'), 'Merge Conflicts');
  h.mod.pr = PR({ autoMergeRequest: { enabledAt: 'x' } });
  tree = h.mod.render();
  assert.equal(text('merge'), 'Merge Auto');
  h.mod.pr = PR({ state: 'MERGED' });
  assert.equal(find(h.mod.render(), 'pr-stats'), undefined);
});

test('merging asks first, names the head it saw, and a failure keeps the question', async () => {
  const h = harness();
  h.mod.pr = PR({ body: 'Body' });
  const calls = [];
  h.mod.api = async (r) => { calls.push(r); if (r.action === 'change-state' && h.fail) throw Error('Refused'); return r.action === 'detail' ? PR() : {}; };
  openActions(h);
  click(h.mod.render(), 'pr-actions-option-squash', h);
  assert.equal(calls.length, 0, 'nothing happens before confirming');
  assert.equal(h.mod.squashMessage.value(), 'Example (#2)\n\nBody');
  h.fail = true;
  click(h.mod.render(), 'pr-change-yes', h); await h.flush();
  assert.match(h.mod.error, /Refused/);
  assert.ok(find(h.mod.render(), 'pr-change-confirm'));
  h.fail = false;
  click(h.mod.render(), 'pr-change-yes', h); await h.flush();
  const merge = calls.filter((c) => c.action === 'change-state').pop();
  assert.equal(merge.event, 'squash'); assert.equal(merge.head, 'abc'); assert.match(merge.body, /Example \(#2\)/);
  assert.equal(find(h.mod.render(), 'pr-change-confirm'), undefined);
});

test('merge when ready uses the repository\'s first method and can be cancelled', async () => {
  const h = harness();
  h.mod.pr = PR({ checks: [FAILED], mergeStateStatus: 'BLOCKED' });
  const calls = [];
  h.mod.api = async (r) => { calls.push(r); return r.action === 'detail' ? PR({ autoMergeRequest: { enabledAt: 'x' } }) : {}; };
  openActions(h);
  click(h.mod.render(), 'pr-actions-option-auto', h);
  click(h.mod.render(), 'pr-change-yes', h); await h.flush();
  assert.equal(calls[0].event, 'auto'); assert.equal(calls[0].method, 'squash'); assert.equal(calls[0].head, 'abc'); assert.equal(calls[0].id, 'pr');
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-stat-merge')), /Auto/);
  openActions(h);
  assert.ok(find(h.mod.render(), 'pr-actions-option-cancel-auto'));
});

test('the list has Branch and Repo tabs, remembered, with no center tab', async () => {
  const storage = new Map();
  const h = harness({ storage });
  h.mod.branchPRs = [{ id: 'a', number: 1, title: 'Mine', state: 'OPEN', updatedAt: new Date().toISOString(), repository: 'owner/repo', author: { login: 'ann' } }];
  const theirs = [{ id: 'b', number: 9, title: 'Theirs', state: 'OPEN', headRefName: 'other', updatedAt: new Date().toISOString(), author: { login: 'bob' } }];
  h.mod.items = theirs;
  h.mod.cursors = { all: 'next' };
  h.mod.api = async () => ({ items: theirs, cursors: {} });
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-view-branch')), /Branch 1/);
  assert.match(strings(find(tree, 'pr-view-all')), /Repo 1\+/);
  assert.ok(find(tree, 'pr-a')); assert.equal(find(tree, 'pr-b'), undefined);
  assert.equal(find(tree, 'pr-filter-row'), undefined, 'filters belong to All PRs');
  assert.ok(find(tree.nodes[0], 'pr-refresh'), 'refresh stays in the header');
  click(tree, 'pr-view-all', h); await h.flush();
  tree = h.mod.render();
  assert.ok(find(tree, 'pr-b')); assert.equal(find(tree, 'pr-a'), undefined);
  assert.ok(find(tree, 'pr-filter-row'));
  assert.equal(storage.get('view'), 'all');
  assert.equal(harness({ storage }).mod.view, 'all');
  assert.equal(h.ran.length, 0, 'nothing opens a tab');
});

test('a PR opens like a commit: the tabs stay, a busy view shows while it loads', async () => {
  const h = harness();
  const other = { id: 'z', number: 8, title: 'Other', state: 'CLOSED', updatedAt: '', repository: 'up/stream', author: { login: 'ann' } };
  h.mod.branchPRs = [{ id: 'a', number: 7, title: 'Fork PR', state: 'OPEN', updatedAt: '', repository: 'up/stream', author: { login: 'ann' } }, other];
  const asked = [];
  let finish;
  h.mod.api = (r) => { asked.push(r); return r.action === 'detail' ? new Promise((done) => { finish = () => done(PR({ number: 7 })); }) : Promise.resolve({ items: [], cursors: {} }); };
  click(h.mod.render(), 'pr-a', h);
  assert.equal(asked[0].repo, 'up/stream', 'its own repository, not the list\'s');
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-busy')), /Loading #7/);
  assert.ok(find(tree, 'pr-view-branch'), 'the tabs stay');
  assert.equal(find(tree, 'pr-a'), undefined, 'the whole content is busy');
  assert.ok(find(tree, 'pr-back'), 'and you can still leave');
  finish(); await h.flush();
  assert.equal(h.mod.pr.repository, 'up/stream');
  tree = h.mod.render();
  assert.equal(find(tree, 'pr-busy'), undefined);
  assert.ok(find(tree.nodes[0], 'pr-view-branch'), 'tabs on top, as with a commit');
  assert.ok(find(tree.nodes[0], 'pr-refresh'));
  assert.equal(tree.nodes[1].elementId, 'pr-about', 'no row just for the number');
  const about = tree.nodes[1];
  assert.match(strings(about.nodes[0]), /Example[\s\S]*#7/);
  assert.ok(find(about.nodes[0], 'pr-detail-github'), 'GitHub with the title');
  assert.ok(find(about.nodes[1], 'pr-actions'), 'Actions with the branches');
  assert.match(strings(about.nodes[1]), /ann · fix → main/);
  const ids = tree.nodes.map((n) => n.elementId);
  assert.ok(ids.indexOf('pr-about') < ids.indexOf('pr-detail-tabs'));
  assert.ok(find(tree, 'pr-create-worktree'), 'worktrees are here too');
  assert.ok(find(tree, 'pr-footer'));
  click(tree, 'pr-back', h);
  assert.equal(h.mod.pr, null);
  assert.ok(find(h.mod.render(), 'pr-a'));
});

test('a branch with one PR shows it straight away, with no back button', async () => {
  const card = { id: 'a', number: 1, title: 'Only', state: 'OPEN', updatedAt: '', repository: 'owner/repo', author: { login: 'ann' }, headRepository: { nameWithOwner: 'owner/repo' } };
  const h = harness({ exec: git([['symbolic-ref', 'fix\n'], ['remote get-url origin', 'git@github.com:owner/repo.git'], ['git remote', 'origin\n']]) });
  h.mod.listLoaded = true;
  const asked = [];
  h.mod.api = async (r) => { asked.push(r.action); if (r.action === 'branch') return { items: [card] }; if (r.action === 'detail') return PR({ number: 1 }); return { items: [], cursors: {} }; };
  h.mod.loadBranchPRs(h.cx); await h.flush();
  assert.equal(h.mod.pr.number, 1);
  let tree = h.mod.render();
  assert.equal(find(tree, 'pr-back'), undefined);
  assert.ok(find(tree, 'pr-actions'));
  const reads = asked.length;
  click(tree, 'pr-view-branch', h); await h.flush();
  assert.equal(h.mod.pr.number, 1, 'its own tab keeps it open');
  assert.equal(asked.length, reads);
  click(tree, 'pr-view-all', h); await h.flush();
  assert.equal(h.mod.pr, null);
  assert.equal(h.mod.view, 'all');
  click(h.mod.render(), 'pr-view-branch', h); await h.flush();
  assert.equal(h.mod.pr.number, 1, 'and coming back opens it again');
  // A second PR on the branch brings the list and back button back.
  h.mod.branchPRs = [card, { ...card, id: 'b', number: 2 }];
  assert.ok(find(h.mod.render(), 'pr-back'));
});

test('tabs show a spinner, not a number, and can\'t be clicked until first loaded', async () => {
  const h = harness();
  h.mod.branchLoaded = false; h.mod.listLoaded = false;
  let tree = h.mod.render();
  for (const id of ['pr-view-branch', 'pr-view-all']) {
    assert.equal(find(tree, id).handlers.click, undefined);
    assert.doesNotMatch(strings(find(tree, id)), /\d/);
  }
  h.mod.branchLoaded = true; h.mod.listLoaded = true; h.mod.total = 4;
  h.mod.branchPRs = [];
  tree = h.mod.render();
  assert.ok(find(tree, 'pr-view-branch').handlers.click); assert.ok(find(tree, 'pr-view-all').handlers.click);
  assert.match(strings(find(tree, 'pr-view-all')), /Repo 4/);
  // Refreshing a filter already read keeps its number; a new filter doesn't.
  h.mod.cache[h.mod.listKey()] = { items: [], cursors: {} };
  h.mod.loading = true;
  assert.match(strings(find(h.mod.render(), 'pr-view-all')), /Repo 4/);
  h.mod.cache = {};
  assert.doesNotMatch(strings(find(h.mod.render(), 'pr-view-all')), /\d/);
});

test('a load that never answers can\'t keep the tabs locked', () => {
  const h = harness();
  h.mod.spaceKey = ''; // no space here, so the poll doesn't see a change of space
  h.mod.listLoaded = false; h.mod.branchLoaded = false;
  h.mod.contextSince = Date.now();
  h.tick();
  assert.equal(h.mod.listLoaded, false);
  h.mod.contextSince = Date.now() - 31000;
  h.tick();
  assert.equal(h.mod.listLoaded, true);
  assert.equal(h.mod.branchLoaded, true);
});

test('a missing or logged-out gh takes over the panel and can be retried', async () => {
  const h = harness();
  h.mod.api = async () => { throw Error('GitHub CLI is not logged in. Run `gh auth login` in a terminal, then refresh.'); };
  h.mod.loadList(h.cx); await h.flush();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-gh-problem')), /isn't logged in[\s\S]*gh auth login/);
  assert.equal(find(tree, 'pr-get-gh'), undefined);
  h.mod.error = 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com, run `gh auth login`, then refresh.';
  tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-gh-problem')), /isn't installed/);
  find(tree, 'pr-get-gh').handlers.click({}, h.cx);
  same(h.opened, ['https://cli.github.com']);
  // An open PR gives way too, and any other error stays a line.
  h.mod.pr = PR();
  assert.ok(find(h.mod.render(), 'pr-gh-problem'));
  h.mod.error = 'Something else';
  assert.equal(find(h.mod.render(), 'pr-gh-problem'), undefined);
  assert.match(strings(find(h.mod.render(), 'pr-error')), /Something else/);
  // Retry clears it.
  h.mod.error = 'GitHub CLI is not logged in. Run gh auth login';
  h.mod.pr = null;
  h.mod.refresh = () => { h.refreshed = true; };
  find(h.mod.render(), 'pr-gh-retry').handlers.click({}, h.cx);
  assert.equal(h.refreshed, true);
  assert.equal(h.mod.error, null);
});

test('refreshing waits while the panel is hidden, and resumes when it shows', () => {
  const { context: m } = harness();
  const panel = (active) => ({ type: 'row', children: [{ id: 'panel', type: 'column', children: [{ id: 'panel-body', type: 'stack', active, children: [{ id: 'files', content: { mod: 'files' } }, { id: 'pulls', content: { mod: 'branch-pr' } }] }] }] });
  assert.equal(m.panelShown(panel('pulls'), 'branch-pr'), true);
  assert.equal(m.panelShown(panel('files'), 'branch-pr'), false);
  const hiddenColumn = panel('pulls'); hiddenColumn.children[0].hidden = true;
  assert.equal(m.panelShown(hiddenColumn, 'branch-pr'), false);
  assert.equal(m.panelShown(null, 'branch-pr'), false);
  const noActive = panel('pulls'); delete noActive.children[0].children[0].active;
  assert.equal(m.panelShown(noActive, 'branch-pr'), false, 'a stack with none chosen shows its first');
  noActive.children[0].children[0].children.reverse();
  assert.equal(m.panelShown(noActive, 'branch-pr'), true);
});

test('a reply starts after its @name, and a message clears when you move on', () => {
  const h = harness();
  h.mod.pr = PR();
  h.mod.compose('comment', null, null, h.cx, { entry: 'e', prefix: '@ann ' });
  same(h.mod.editor.selected, { start: 5, end: 5 });
  h.mod.notice = 'Saved to GitHub.';
  h.mod.selectSection('checks', h.cx);
  assert.equal(h.mod.notice, null);
  h.mod.notice = 'Saved to GitHub.';
  h.mod.api = async () => ({ items: [], cursors: {} });
  h.mod.backToList(h.cx);
  assert.equal(h.mod.notice, null);
});

test('failed logs lose their prefixes and colour codes', () => {
  const { context: m } = harness();
  const raw = 'test\tRun tests\t\uFEFF2026-11-05T03:27:19.82Z ##[group]Run sh test.sh\ntest\tRun tests\t2026-11-05T03:27:19.82Z ^[[36;1msh test.sh^[[0m\ntest\tRun tests\t2026-11-05T03:27:19.84Z greet.sh should say hello\n';
  assert.equal(m.cleanLog(raw), '##[group]Run sh test.sh\nsh test.sh\ngreet.sh should say hello\n');
  assert.equal(m.cleanLog(undefined), '');
});

test('the next batch is offered at the end of the list, saying how many', async () => {
  const h = harness();
  h.mod.view = 'all'; h.mod.branchLoaded = true; h.mod.listLoaded = true;
  const row = (n) => ({ id: `p${n}`, number: n, title: 'T', state: 'OPEN', headRefName: 'b', updatedAt: `2026-01-${10 + n}`, author: { login: 'a' } });
  h.mod.items = [row(1), row(2)];
  h.mod.total = 30; h.mod.cursors = { all: 'next' };
  h.mod.settings = { ...h.mod.settings, list: { ...h.mod.settings.list, page_size: 25 } };
  assert.match(strings(find(h.mod.render(), 'pr-more')), /\+ 25 more/);
  h.mod.total = 4;
  assert.match(strings(find(h.mod.render(), 'pr-more')), /\+ 2 more/);
  h.mod.total = null;
  assert.match(strings(find(h.mod.render(), 'pr-more')), /\+ more/);
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return { items: [row(3)], cursors: {} }; };
  click(h.mod.render(), 'pr-more', h); await h.flush();
  assert.equal(asked[0].cursors.all, 'next');
  assert.equal(h.mod.items.length, 3);
  assert.equal(find(h.mod.render(), 'pr-more'), undefined);
});

test('going back while a PR loads cancels it, and a failure returns to the list', async () => {
  const h = harness();
  const other = { id: 'z', number: 8, title: 'Other', state: 'CLOSED', updatedAt: '', repository: 'o/r', author: { login: 'ann' } };
  h.mod.branchPRs = [{ id: 'a', number: 7, title: 'T', state: 'OPEN', updatedAt: '', repository: 'o/r', author: { login: 'ann' } }, other];
  let finish;
  h.mod.api = (r) => (r.action === 'detail' ? new Promise((done) => { finish = () => done(PR({ number: 7 })); }) : Promise.resolve({ items: [], cursors: {} }));
  click(h.mod.render(), 'pr-a', h);
  click(h.mod.render(), 'pr-back', h);
  finish(); await h.flush();
  assert.equal(h.mod.pr, null);
  assert.equal(find(h.mod.render(), 'pr-busy'), undefined);
  h.mod.api = async () => { throw Error('down'); };
  click(h.mod.render(), 'pr-a', h); await h.flush();
  const tree = h.mod.render();
  assert.equal(find(tree, 'pr-busy'), undefined);
  assert.ok(find(tree, 'pr-a')); assert.ok(find(tree, 'pr-retry'));
});

test('a tab click from a PR goes to that list', async () => {
  const h = harness();
  h.mod.api = async () => ({ items: [], cursors: {} });
  h.mod.pr = PR();
  click(h.mod.render(), 'pr-view-all', h); await h.flush();
  assert.equal(h.mod.pr, null);
  assert.equal(h.mod.view, 'all');
});

test('the count is GitHub\'s total for the filter, not what happens to be loaded', async () => {
  const h = harness();
  h.mod.api = async () => ({ items: [{ id: 'x', number: 1, title: 'T', state: 'OPEN', updatedAt: '', headRefName: 'b', author: { login: 'a' } }], cursors: { all: 'next' }, total: 137 });
  h.mod.loadList(h.cx); await h.flush();
  assert.match(strings(find(h.mod.render(), 'pr-view-all')), /Repo 137/);
  h.mod.api = async () => ({ items: [{ id: 'x', number: 1, title: 'T', state: 'OPEN', updatedAt: '', headRefName: 'b', author: { login: 'a' } }], cursors: { involves: 'next' } });
  h.mod.tab = 'involved';
  h.mod.loadList(h.cx); await h.flush();
  assert.match(strings(find(h.mod.render(), 'pr-view-all')), /Repo 1\+/);
});

test('every action is in the header menu, Close set apart, and none on a merged PR', () => {
  const h = harness();
  h.mod.pr = PR();
  assert.equal(find(h.mod.render(), 'pr-change-close'), undefined);
  openActions(h);
  const tree = h.mod.render();
  for (const id of ['squash', 'merge', 'close']) assert.ok(find(tree, `pr-actions-option-${id}`));
  h.mod.pr = PR({ state: 'MERGED' });
  assert.equal(find(h.mod.render(), 'pr-actions'), undefined);
});

test('merging past something in the way says what, before you confirm', () => {
  const h = harness();
  h.mod.pr = PR({ checks: [FAILED], threads: [THREAD()], mergeStateStatus: 'UNSTABLE' });
  openActions(h);
  click(h.mod.render(), 'pr-actions-option-squash', h);
  assert.match(strings(find(h.mod.render(), 'pr-change-confirm')), /Still in the way: 1 check failed, 1 unresolved\./);
  h.mod.pr = PR();
  h.mod.stateChange = null;
  openActions(h);
  click(h.mod.render(), 'pr-actions-option-squash', h);
  assert.doesNotMatch(strings(find(h.mod.render(), 'pr-change-confirm')), /Still in the way/);
});

test('the confirmation shows from any tab', () => {
  const h = harness();
  h.mod.pr = PR();
  h.mod.section = 'checks';
  openActions(h);
  click(h.mod.render(), 'pr-actions-option-close', h);
  assert.ok(find(h.mod.render(), 'pr-change-confirm'));
});

test('Overview groups collapse and stay that way; a resolved thread starts shut', () => {
  const storage = new Map();
  const h = harness({ storage });
  h.mod.pr = PR({ reviewers: [{ login: 'ann', state: 'APPROVED' }], threads: [THREAD({ isResolved: true })] });
  let tree = h.mod.render();
  assert.ok(find(tree, 'pr-reviewer-ann'));
  click(tree, 'pr-group-reviewers', h);
  tree = h.mod.render();
  assert.equal(find(tree, 'pr-reviewer-ann'), undefined);
  assert.match(strings(find(tree, 'pr-group-reviewers')), /Reviewers\s+1/);
  const again = harness({ storage });
  again.mod.pr = h.mod.pr;
  assert.equal(find(again.mod.render(), 'pr-reviewer-ann'), undefined);
  h.mod.section = 'conversation';
  tree = h.mod.render();
  assert.doesNotMatch(strings(tree), /Rename this/);
  click(tree, 'pr-entry-toggle-t1', h);
  assert.match(strings(h.mod.render()), /Rename this/);
});

test('agents on the PR are listed and a click goes to them', () => {
  const h = harness();
  h.mod.pr = PR();
  h.live.agents = [AGENT('t1', { status: 'working' })];
  h.live.panes = [{ pane: 'p-t1', cwd: '/repo', branch: 'fix' }];
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-agent-t1')), /Agent t1 working/);
  find(tree, 'pr-agent-t1').handlers.click({}, h.cx);
  same(h.ran.at(-1), ['agent.focus', { terminal: 't1' }]);
});

test('reviewers show their standing and can be asked again, but only while open', async () => {
  const h = harness();
  h.mod.pr = PR({ reviewDecision: 'CHANGES_REQUESTED', reviewers: [{ login: 'ann', state: 'CHANGES_REQUESTED' }, { login: 'bob', state: 'REQUESTED' }] });
  const calls = [];
  h.mod.api = async (r) => { calls.push(r); return r.action === 'detail' ? h.mod.pr : {}; };
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-group-reviewers')), /Reviewers\s+2\s+Changes requested/);
  assert.equal(find(tree, 'pr-reviewer-again-bob'), undefined, 'still waiting on them');
  click(tree, 'pr-reviewer-again-ann', h, {}); await h.flush();
  assert.equal(calls[0].action, 'reviewer'); assert.equal(calls[0].reviewer, 'ann');
  h.mod.pr = PR({ state: 'CLOSED', reviewers: [{ login: 'ann', state: 'APPROVED' }] });
  assert.equal(find(h.mod.render(), 'pr-reviewer-again-ann'), undefined);
});

test('checks group by run, fetch jobs on opening, and a failure goes to the agent you pick', async () => {
  const h = harness();
  h.mod.pr = PR({ checks: [{ name: 'lint', conclusion: 'SUCCESS', workflowName: 'CI', detailsUrl: 'https://github.com/o/r/actions/runs/77/job/1' }, { ...FAILED, workflowName: 'CI' }] });
  h.mod.section = 'checks';
  h.live.agents = [AGENT('t1')];
  h.live.panes = [{ pane: 'p-t1', cwd: '/repo', branch: 'fix' }];
  const calls = [];
  h.mod.api = async (r) => { calls.push(r); return r.action === 'jobs' ? [{ jobs: [{ id: 88, name: 'build', conclusion: 'failure', steps: [{ name: 'Run tests', conclusion: 'failure' }] }] }] : { text: 'boom', truncated: false }; };
  let tree = h.mod.render();
  assert.match(strings(tree), /CI 2/);
  assert.equal(find(tree, 'pr-fix-0'), undefined, 'nothing to fix on a passing check');
  await pick(h, 'pr-fix-1', 't1');
  assert.equal(h.sent[0][0], 'send'); assert.equal(h.sent[0][1], 't1');
  assert.match(h.sent[0][2], /--job 88/);
  assert.equal(h.mod.notice, 'Sent to Agent t1.');
  click(tree, 'check-toggle-1', h); await h.flush();
  assert.equal(calls[0].run, 77);
  tree = h.mod.render();
  assert.match(strings(tree), /Run tests/);
  click(tree, 'pr-log-88', h); await h.flush();
  assert.match(strings(h.mod.render()), /boom/);
});

test('without an agent the handoff says so and sends nothing', () => {
  const h = harness();
  h.mod.pr = PR({ checks: [FAILED] });
  h.mod.section = 'checks';
  const fix = find(h.mod.render(), 'pr-fix-0');
  assert.match(strings(fix), /no agent/);
  assert.equal(fix.handlers.click, undefined);
});

const pick = async (h, menu, option) => {
  find(h.mod.render(), menu).handlers.open(true, h.cx);
  click(h.mod.render(), `${menu}-option-${option}`, h);
  await h.flush();
};

test('a handoff is a dropdown: the agent on the PR first, then others, then a new one', async () => {
  const h = harness({ known: [{ key: 'claude', name: 'Claude Code', run: ['claude'], installed: true }, { key: 'pi', name: 'Pi', run: ['pi'], installed: false }] });
  h.mod.pr = PR({ checks: [FAILED] });
  h.mod.section = 'checks';
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  h.live.agents = [AGENT('free'), AGENT('onit')];
  h.live.panes = [{ pane: 'p-free', cwd: '/repo', branch: 'main' }, { pane: 'p-onit', cwd: '/repo', branch: 'fix' }];
  find(h.mod.render(), 'pr-fix-0').handlers.open(true, h.cx);
  const menu = strings(find(h.mod.render(), 'pr-fix-0-menu'));
  assert.match(menu, /Agent onit[\s\S]*Agent free[\s\S]*Start new Claude Code/);
  assert.doesNotMatch(menu, /Pi/, 'only what is installed');
  assert.equal(h.sent.length, 0, 'opening the menu sends nothing');
  click(h.mod.render(), 'pr-fix-0-option-free', h); await h.flush();
  assert.equal(h.sent[0][1], 'free');
  await pick(h, 'pr-fix-0', 'new:claude');
  assert.equal(h.sent.length, 1, 'a new agent is not sent to through hc');
  const [name, args] = h.ran.at(-1);
  assert.equal(name, 'tab.new');
  assert.equal(args.folder, '/repo');
  assert.deepEqual(JSON.parse(JSON.stringify(args.argv)), ['claude']);
  assert.match(args.task, /--log-failed/);
  assert.equal(h.mod.notice, 'Started new Claude Code in a new tab.');
});

test('(spawn) starts a sub-agent under the running agent, in the worktree, with no shell', async () => {
  const claude = { key: 'claude', name: 'Claude Code', run: ['claude'], installed: true };
  const h = harness({ known: [claude] });
  h.mod.pr = PR({ checks: [FAILED] });
  h.mod.section = 'checks';
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  h.mod.worktrees = { key: h.mod.worktreeKey(), list: [{ path: '/wt/PR-2', branch: 'fix', name: 'PR-2' }] };
  h.live.agents = [AGENT('t1', { program: { key: 'claude' }, status: 'working' }), AGENT('t2', { program: { key: 'other' } })];
  find(h.mod.render(), 'pr-fix-0').handlers.open(true, h.cx);
  const menu = strings(find(h.mod.render(), 'pr-fix-0-menu'));
  assert.match(menu, /Agent t1 \(spawn\)/);
  assert.doesNotMatch(menu, /Agent t2 \(spawn\)/, 'no sub-agent of a kind we cannot start');
  click(h.mod.render(), 'pr-fix-0-option-spawn:t1', h); await h.flush();
  const args = [...h.sent[0]];
  assert.deepEqual(args.slice(0, 8), ['run', '--bg', '--json', '--parent', 't1', '--cwd', '/wt/PR-2', 'claude']);
  assert.match(args[8], /--log-failed/);
  assert.equal(args.length, 9, 'the message is one argument');
  assert.equal(h.mod.notice, 'Started a sub-agent under Agent t1.');
  const flag = h.mod.hcArgs(h.mod.agentAt('spawn:t1'), '--dangerously-skip-permissions');
  assert.equal(flag.at(-1), ' --dangerously-skip-permissions', 'text is never read as a flag');
  await pick(h, 'pr-fix-0', 'new:claude');
  assert.equal(h.ran.at(-1)[1].folder, '/wt/PR-2', 'a new agent works in the worktree too');
});

test('a comment sent with (spawn) stays a spawn through the editable prompt', async () => {
  const h = harness({ known: [{ key: 'claude', name: 'Claude Code', run: ['claude'], installed: true }] });
  h.mod.pr = PR({ threads: [THREAD()] });
  h.mod.section = 'conversation';
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  h.live.agents = [AGENT('t1', { status: 'working', program: { key: 'claude' } })];
  await pick(h, 'pr-agent-send-t1', 'spawn:t1');
  const box = strings(h.mod.render());
  assert.match(box, /Send to Agent t1 \(spawn\)/);
  assert.doesNotMatch(box, /busy/);
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'pr-submit', h); await h.flush();
  assert.equal(h.sent[0][0], 'run');
  assert.equal(h.sent[0][4], 't1');
  assert.match(h.sent[0].at(-1), /^Look at this/);
});

test('a comment can go to a new agent through the same editable prompt', async () => {
  const h = harness({ known: [{ key: 'claude', name: 'Claude Code', run: ['claude'], installed: true }] });
  h.mod.pr = PR({ threads: [THREAD()] });
  h.mod.section = 'conversation';
  h.mod.sp = { id: 'space', folder: '/repo', machine: null };
  h.mod.loadNewAgents(h.mod.sp, h.cx); await h.flush();
  await pick(h, 'pr-agent-send-t1', 'new:claude');
  assert.equal(h.ran.filter(([n]) => n === 'tab.new').length, 0, 'only Send delivers');
  assert.match(strings(h.mod.render()), /Send to new Claude Code/);
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'pr-submit', h); await h.flush();
  assert.match(h.ran.at(-1)[1].task, /^Look at this/);
  assert.equal(h.mod.composer, null);
});

test('a failed delivery says why and notes no success', async () => {
  const h = harness({ hc: async () => ({ code: 1, stderr: 'gone' }) });
  h.mod.pr = PR({ checks: [FAILED] });
  h.mod.fixCheck(FAILED, AGENT('t1'), h.cx); await h.flush();
  assert.equal(h.mod.error, 'gone');
  assert.equal(h.mod.notice ?? null, null);
  assert.equal(h.mod.mutating, false);
});

test('all unresolved threads go to the agent together', async () => {
  const h = harness();
  h.mod.pr = PR({ threads: [THREAD(), THREAD({ id: 't2', path: 'b.go' })] });
  h.mod.section = 'conversation';
  h.live.agents = [AGENT('t1')];
  h.live.panes = [{ pane: 'p-t1', cwd: '/repo', branch: 'fix' }];
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-send-unresolved')), /Send 2 to agent/);
  await pick(h, 'pr-send-unresolved', 't1');
  assert.match(h.sent[0][2], /a\.go:3/); assert.match(h.sent[0][2], /b\.go:3/);
});

test('a comment goes to an agent through an editable prompt that only Send delivers', async () => {
  const h = harness();
  h.mod.pr = PR({ threads: [THREAD()] });
  h.mod.section = 'conversation';
  h.live.agents = [AGENT('t1')];
  h.live.panes = [{ pane: 'p-t1', cwd: '/repo', branch: 'fix' }];
  await pick(h, 'pr-agent-send-t1', 't1');
  assert.equal(h.sent.length, 0);
  assert.equal(h.mod.composer.kind, 'agent');
  h.mod.editor.set_value('Look at this');
  click(h.mod.render(), 'pr-submit', h); await h.flush();
  assert.match(h.sent[0][2], /^Look at this/);
  assert.match(h.sent[0][2], /cam: Rename this/);
  assert.equal(h.mod.composer, null);
});

test('a comment has an icon to copy its link, and Send to agent on the right', () => {
  const h = harness();
  h.mod.pr = PR({ threads: [THREAD()] });
  h.mod.section = 'conversation';
  h.live.agents = [AGENT('t1')];
  const tree = h.mod.render();
  assert.equal(strings(find(tree, 'pr-copy-tc')).trim(), '', 'an icon, not the words');
  const block = find(tree, 'conversation-t1');
  const actions = find(block, 'pr-agent-send-t1');
  assert.ok(actions);
});

test('comments filter by author and unresolved, and a hunk shows only its end', () => {
  const h = harness();
  h.mod.pr = PR({ threads: [THREAD()] });
  h.mod.section = 'conversation';
  let text = strings(h.mod.render());
  assert.match(text, /First/); assert.match(text, /Rename this/);
  assert.match(text, /3\n4\n5\n6\n7\n8/); assert.doesNotMatch(text, /1\n2\n3/);
  h.mod.author = 'cam';
  text = strings(h.mod.render());
  assert.doesNotMatch(text, /First/); assert.match(text, /Rename this/);
  h.mod.author = '';
  h.mod.unresolved = true;
  assert.doesNotMatch(strings(h.mod.render()), /First/);
});

test('the author filter works from the keyboard', () => {
  const h = harness();
  h.mod.pr = PR();
  h.mod.section = 'conversation';
  find(h.mod.render(), 'pr-author').handlers.open(true, h.cx);
  const menu = () => find(h.mod.render(), 'pr-author-menu');
  menu().handlers.key({ key: 'down' }, h.cx);
  menu().handlers.key({ key: 'enter' }, h.cx);
  assert.equal(h.mod.author, 'bob');
  assert.equal(h.mod.openMenu, null);
});

test('a failed post keeps the draft; a good one clears it', async () => {
  const h = harness();
  h.mod.pr = PR();
  h.mod.compose('reply', 'thread', null, h.cx, { entry: 'e' });
  h.mod.editor.set_value('Keep this');
  h.storage.set(h.mod.draftKey, 'Keep this');
  h.mod.api = async () => { throw Error('offline'); };
  h.mod.mutate('reply', h.cx, 'thread'); await h.flush();
  assert.equal(h.mod.editor.value(), 'Keep this');
  assert.ok(h.mod.composer);
  h.mod.api = async (r) => (r.action === 'detail' ? PR() : {});
  const draft = h.mod.draftKey;
  h.mod.mutate('reply', h.cx, 'thread'); await h.flush();
  assert.equal(h.mod.composer, null);
  assert.equal(h.storage.has(draft), false);
});

test('a new comment is written after the last one, and its draft stays with the PR', async () => {
  const h = harness();
  h.mod.adoptPR(PR());
  h.mod.section = 'conversation';
  let tree = h.mod.render();
  assert.ok(find(tree, 'pr-new-comment'));
  assert.equal(find(tree, 'pr-add-comment').handlers.click, undefined, 'nothing to post yet');
  h.mod.newComment.set_value('Hello');
  h.storage.set(h.mod.commentKey, 'Hello');
  h.mod.backToList(h.cx);
  h.mod.adoptPR(PR());
  assert.equal(h.mod.newComment.value(), 'Hello');
  h.mod.api = async () => { throw Error('offline'); };
  find(h.mod.render(), 'pr-add-comment').handlers.click({}, h.cx); await h.flush();
  assert.equal(h.mod.newComment.value(), 'Hello', 'a failed post keeps it');
  const asked = [];
  h.mod.api = async (r) => { asked.push(r); return r.action === 'detail' ? PR() : {}; };
  find(h.mod.render(), 'pr-add-comment').handlers.click({}, h.cx); await h.flush();
  assert.equal(asked[0].action, 'comment');
  assert.equal(asked[0].body, 'Hello');
  assert.equal(h.mod.newComment.value(), '');
  assert.equal(h.storage.has(h.mod.commentKey), false);
});

test('a confirmation leaves after a few seconds', () => {
  const h = harness();
  h.tick(); // settles on the space first, which clears any notice
  h.mod.notice = 'Saved to GitHub.';
  h.tick();
  assert.equal(h.mod.notice, 'Saved to GitHub.');
  h.mod.noticeSince = Date.now() - 6000;
  h.tick();
  assert.equal(h.mod.notice, null);
});

test('comments say none exist unless a filter is hiding them', () => {
  const h = harness();
  h.mod.pr = PR({ comments: [], reviews: [], threads: [] });
  h.mod.section = 'conversation';
  assert.match(strings(h.mod.render()), /No comments yet/);
  h.mod.unresolved = true;
  assert.match(strings(h.mod.render()), /No comments match these filters/);
});

test('read markers notice new and edited comments, and survive leaving', () => {
  const storage = new Map();
  const h = harness({ storage });
  h.mod.adoptPR(PR());
  assert.equal(h.mod.unreadIds.size, 1);
  h.mod.markRead();
  h.mod.adoptPR(PR());
  assert.equal(h.mod.unreadIds.size, 0);
  const edited = PR(); edited.comments[0].body = 'Changed';
  h.mod.adoptPR(edited);
  assert.equal(h.mod.unreadIds.size, 1);
});

// ── Lists and discovery ─────────────────────────────────────────────────────

test('list rows show the state and the checks, and open the PR', async () => {
  const h = harness();
  h.mod.view = 'all';
  h.mod.items = [{ id: 'a', number: 7, title: 'Thing', state: 'OPEN', headRefName: 'b', updatedAt: new Date().toISOString(), author: { login: 'ann' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }];
  h.mod.api = async () => PR({ number: 7 });
  const tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-a')), /Thing[\s\S]*ann · just now · b[\s\S]*#7/);
  click(tree, 'pr-a', h); await h.flush();
  assert.equal(h.mod.pr.number, 7);
});

test('a stale list answer does not replace another space', async () => {
  const h = harness();
  let finish;
  h.mod.api = () => new Promise((r) => { finish = r; });
  h.mod.loadList(h.cx);
  h.mod.changeSpace(null, 'other', h.cx);
  finish({ items: [{ id: 'old', updatedAt: '' }], cursors: {} }); await h.flush();
  assert.equal(h.mod.items.length, 0);
});

test('a number is worth searching at any length', async () => {
  const h = harness();
  same(['7', '#7', 'ab', 'abc', ' 482 '].map(h.context.searchQuery), ['7', '#7', '', 'abc', '482']);
});

test('search waits for typing to stop and needs three characters', async () => {
  const h = harness();
  const asked = [];
  h.mod.api = async (r) => { asked.push(r.search); return { items: [], cursors: {} }; };
  h.mod.search.set_value('ab');
  h.mod.search.handlers.change({}, h.cx);
  h.fireAfter(); await h.flush();
  same(asked, []);
  h.mod.search.set_value('abc');
  h.mod.search.handlers.change({}, h.cx);
  h.mod.search.set_value('abcd');
  h.mod.search.handlers.change({}, h.cx);
  h.fireAfter(); await h.flush();
  same(asked, ['abcd']);
});

const git = (answers) => async (bin, args) => {
  const line = `${bin} ${args.join(' ')}`;
  for (const [pattern, stdout] of answers) if (line.includes(pattern)) return { code: 0, stdout, stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

test('All PRs prefers upstream, and shows a remote it cannot use as disabled', async () => {
  const h = harness({ exec: git([['remote get-url upstream', 'git@github.com:up/repo.git'], ['remote get-url origin', 'git@gitlab.com:g/p.git'], ['git remote', 'origin\nupstream\n']]) });
  h.mod.view = 'all';
  h.mod.repo = '';
  h.mod.api = async () => ({ items: [], cursors: {} });
  h.mod.resolveRepo(h.cx); await h.flush();
  assert.equal(h.mod.repo, 'up/repo');
  assert.equal(h.mod.remote, 'upstream');
  const tree = h.mod.render();
  find(tree, 'pr-remote').handlers.open(true, h.cx);
  const open = h.mod.render();
  assert.match(strings(find(open, 'pr-remote-option-origin')), /Not a GitHub remote/);
  assert.equal(find(open, 'pr-remote-option-origin').handlers.click, undefined);
});

test('This branch lists every PR from the branch, without forks of the same name', async () => {
  const card = (id, number, repo, state = 'OPEN') => ({ id, number, title: `T${number}`, state, updatedAt: `2026-01-0${number}`, repository: 'owner/repo', author: { login: 'ann' }, headRepository: { nameWithOwner: repo } });
  const h = harness({ exec: git([['symbolic-ref', 'fix\n'], ['remote get-url origin', 'git@github.com:owner/repo.git'], ['git remote', 'origin\n']]) });
  h.mod.api = async () => ({ items: [card('a', 1, 'owner/repo', 'CLOSED'), card('b', 2, 'stranger/repo'), card('c', 3, 'owner/repo')] });
  h.mod.loadBranchPRs(h.cx); await h.flush();
  same([...h.mod.branchPRs].map((p) => p.id), ['c', 'a']);
  assert.equal(h.mod.pr ?? null, null, 'opening one is your choice');
  const tree = h.mod.render();
  assert.ok(find(tree, 'pr-c')); assert.ok(find(tree, 'pr-a'));
});

test('a branch linked to its PR shows just that one, with its checks', async () => {
  const h = harness({ exec: git([['symbolic-ref', 'fix\n'], ['herdr-pr', 'owner/repo#2\n']]) });
  h.mod.api = async () => PR({ checks: [FAILED], updatedAt: new Date().toISOString() });
  h.mod.loadBranchPRs(h.cx); await h.flush();
  assert.equal(h.mod.branchPRs.length, 1);
  assert.equal(h.mod.pr.number, 2, 'and opens it');
  assert.match(strings(find(h.mod.render(), 'pr-stat-checks')), /0\/1/);
});

test('a branch with no PR, and no branch at all, say so', async () => {
  const h = harness({ exec: git([]) });
  h.mod.loadBranchPRs(h.cx); await h.flush();
  assert.match(strings(h.mod.render()), /Check out a branch/);
  h.mod.branch = 'fix';
  assert.match(strings(h.mod.render()), /No pull requests from fix/);
});

test('a reload reopens the saved PR once, and a failed read keeps the screen', async () => {
  const storage = new Map();
  const first = harness({ storage });
  first.mod.restoreView('owner/repo');
  first.mod.tab = 'involved'; first.mod.state = 'merged';
  first.mod.adoptPR(PR(), 'up/stream');
  first.mod.rememberView();
  const second = harness({ storage });
  second.mod.browseKey = null;
  second.mod.restoreView('owner/repo');
  assert.equal(second.mod.tab, 'involved'); assert.equal(second.mod.state, 'merged');
  const asked = [];
  second.mod.api = async (r) => { asked.push(r); return r.action === 'detail' ? PR() : { items: [], cursors: {} }; };
  second.mod.loadList(second.cx); await second.flush();
  assert.equal(asked.find((r) => r.action === 'detail').repo, 'up/stream');
  assert.equal(second.mod.pr.number, 2);
  // Back on the list, a later load doesn't reopen it.
  second.mod.backToList(second.cx);
  second.mod.restoreSelection = { number: 2 };
  second.mod.loadList(second.cx); await second.flush();
  assert.equal(second.mod.pr, null);
  second.mod.pr = PR();
  second.mod.api = async () => { throw Error('down'); };
  second.mod.openPR(2, second.cx); await second.flush();
  assert.equal(second.mod.error, 'down');
  assert.equal(second.mod.pr.number, 2);
  assert.ok(find(second.mod.render(), 'pr-retry'));
});

test('settings set list defaults and page size, and problems show at the top', async () => {
  const h = harness();
  h.mod.settingsProblems = ['refresh.every: wrong type'];
  assert.match(strings(find(h.mod.render(), 'pr-settings-problems')), /wrong type/);
  const asked = [];
  h.mod.settings = { ...h.mod.settings, list: { page_size: 5, default: { tab: 'mine', state: 'draft' } } };
  h.mod.api = async (r) => { asked.push(r); return { items: [], cursors: {} }; };
  h.mod.loadList(h.cx); await h.flush();
  assert.equal(asked[0].pageSize, 5);
});

// ── Worktrees ───────────────────────────────────────────────────────────────

test('a worktree on the PR\'s head branch counts without a herdr-pr binding, as when the PR came from it', async () => {
  const list = 'worktree /repo\nHEAD a\nbranch refs/heads/main\n\nworktree /wt/mine\nHEAD b\nbranch refs/heads/fix\n\n';
  const h = harness({ exec: git([['--get-regexp', ''], ['worktree list', list]]) });
  h.mod.pr = PR();
  h.mod.loadWorktrees(h.cx); await h.flush();
  same(h.mod.currentWorktrees(), [{ path: '/wt/mine', branch: 'fix', name: 'mine' }]);
});

test('a PR\'s worktrees are listed and a click switches to or opens their space', async () => {
  const h = harness({ exec: git([['--get-regexp', 'branch.fix.herdr-pr owner/repo#2\n'], ['worktree list', 'worktree /wt/PR-2\nHEAD abc\nbranch refs/heads/fix\n\n']]) });
  h.mod.pr = PR({ repository: 'owner/repo' });
  h.mod.loadWorktrees(h.cx); await h.flush();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-worktree-row-0')), /PR-2\s+fix/);
  find(tree, 'pr-worktree-row-0').handlers.click({}, h.cx);
  assert.equal(h.ran.at(-1)[0], 'space.new');
  h.live.spaces = [{ id: 'wt', folder: '/wt/PR-2' }];
  tree = h.mod.render();
  find(tree, 'pr-worktree-row-0').handlers.click({}, h.cx);
  same(h.ran.at(-1), ['space.select', { id: 'wt' }]);
});

test('a new worktree fetches the verified head and opens as a space', async () => {
  const head = 'a'.repeat(40);
  const log = [];
  const exec = async (bin, args) => {
    const line = `${bin} ${args.join(' ')}`;
    log.push(line);
    if (line.includes('check-ref-format')) return { code: 0, stdout: 'fix\n' };
    if (line.includes('remote get-url')) return { code: 0, stdout: 'git@github.com:owner/repo.git\n' };
    if (line.endsWith('git remote')) return { code: 0, stdout: 'origin\n' };
    if (line.includes('show-ref')) return { code: 1, stdout: '' };
    if (line.includes('rev-parse')) return { code: 0, stdout: `${head}\n` };
    if (line.includes('--get-regexp') || line.includes('worktree list')) return { code: 1, stdout: '' };
    return { code: 0, stdout: '' };
  };
  const h = harness({ exec });
  h.mod.pr = PR({ headRefOid: head });
  h.mod.api = async () => PR({ headRefOid: head });
  h.mod.showWorktree(h.cx); await h.flush();
  assert.equal(h.mod.worktreeForm.branch.value(), 'fix');
  assert.equal(h.mod.worktreeForm.name.value(), 'PR-2');
  click(h.mod.render(), 'pr-worktree-submit', h); await h.flush();
  assert.ok(log.some((l) => l.includes('fetch --no-tags -- git@github.com:owner/repo.git refs/pull/2/head')));
  assert.ok(log.some((l) => l.includes(`worktree add -b fix -- /home/sam/.herdr/worktrees/owner-repo/PR-2 ${head}`)));
  assert.ok(log.some((l) => l.includes('config branch.fix.herdr-pr owner/repo#2')));
  assert.equal(h.ran.at(-1)[0], 'space.new');
  assert.equal(h.mod.worktreeForm, null);
});

test('a worktree name with a path in it is refused, and a moved PR stops the checkout', async () => {
  const log = [];
  const exec = async (bin, args) => {
    const line = `${bin} ${args.join(' ')}`;
    log.push(line);
    if (line.includes('check-ref-format')) return { code: 0, stdout: 'fix\n' };
    if (line.includes('remote get-url')) return { code: 0, stdout: 'git@github.com:owner/repo.git\n' };
    if (line.endsWith('git remote')) return { code: 0, stdout: 'origin\n' };
    if (line.includes('show-ref')) return { code: 1, stdout: '' };
    if (line.includes('rev-parse')) return { code: 0, stdout: `${'b'.repeat(40)}\n` };
    return { code: 0, stdout: '' };
  };
  const h = harness({ exec });
  h.mod.pr = PR();
  h.mod.showWorktree(h.cx); await h.flush();
  h.mod.worktreeForm.name.set_value('../evil');
  h.mod.createWorktree(h.cx); await h.flush();
  assert.match(h.mod.worktreeForm.error, /letters, numbers/);
  h.mod.worktreeForm.name.set_value('PR-2');
  h.mod.api = async () => PR({ headRefOid: 'a'.repeat(40) });
  h.mod.createWorktree(h.cx); await h.flush();
  assert.match(h.mod.worktreeForm.error, /changed while fetching/);
  assert.equal(log.some((l) => l.includes('worktree add')), false);
});

// A file's diff opens in Better Changes' centre tab; Branch PR has none of its own.
test('nothing left of GitLab, previews, pending reviews, proposals or a center tab', () => {
  assert.doesNotMatch(source, /gitlab|glab|merge-requests|proposal|pendingReview|start-review|setPreview|\.workflow\/|mod: "branch-pr"|openBrowser/i);
});

// ── Files ───────────────────────────────────────────────────────────────────

test('a merged PR shows a Merged badge where Actions would be', () => {
  const h = harness();
  h.mod.pr = PR({ state: 'MERGED' });
  const tree = h.mod.render();
  assert.equal(find(tree, 'pr-actions'), undefined);
  assert.match(strings(find(tree, 'pr-merged')), /Merged/);
  h.mod.pr = PR();
  assert.equal(find(h.mod.render(), 'pr-merged'), undefined);
});

const FILE = { filename: 'src/a.go', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' };
const filesHarness = () => harness({ exec: async (_bin, [request]) => ({ code: 0, stdout: JSON.stringify(JSON.parse(request).action === 'files' ? [[FILE]] : {}), stderr: '' }) });

test('the Files tab counts the files, lists them, and opens one on GitHub without Better Changes', async () => {
  const h = filesHarness();
  h.mod.pr = PR({ changedFiles: 1 });
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-files')), /Files 1/);
  click(tree, 'pr-files', h);
  await h.flush();
  tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-file-src/a.go')), /a\.go \+3 −1/);
  click(tree, 'pr-file-src/a.go', h);
  same(h.opened, ['https://github.com/owner/repo/pull/2/files']);
  same(h.ran, []);
});

test("with Better Changes, a file's GitHub patch opens in its diff tab", async () => {
  const h = filesHarness();
  await h.flush(); // the check for Better Changes, which finds none here
  h.mod.hasBetterChanges = true;
  h.live.spaces = [{ id: 'space', active: true, tabs: [{ id: 't1' }] }];
  h.mod.pr = PR();
  h.mod.selectSection('files', h.cx);
  await h.flush();
  click(h.mod.render(), 'pr-file-src/a.go', h);
  const entry = h.live.shared['better-changes.diff-tabs'].space;
  same(entry.source, { cwd: '/repo', on: null });
  assert.equal(entry.selection.scope, 'patch');
  assert.equal(entry.selection.context, JSON.stringify(entry.source));
  same(entry.selection.file, { path: 'src/a.go', add: 3, del: 1, patch: FILE.patch });
  assert.equal(h.ran[0][0], 'tab.new');
  h.live.panes = [{ mod: 'better-changes', tab: 't1' }];
  click(h.mod.render(), 'pr-file-src/a.go', h);
  same(h.ran.slice(1), [['tab.rename', { id: 't1', name: 'a.go' }], ['tab.select', { id: 't1' }]]);
  same(h.opened, []);
});

test('the Files tab shows a tree by default, folders close, and the toggle remembers a flat list', async () => {
  const h = filesHarness();
  h.mod.pr = PR();
  h.mod.selectSection('files', h.cx);
  await h.flush();
  let tree = h.mod.render();
  assert.match(strings(find(tree, 'pr-folder-src')), /src/);
  click(tree, 'pr-folder-src', h);
  assert.equal(find(h.mod.render(), 'pr-file-src/a.go'), undefined);
  click(h.mod.render(), 'pr-folder-src', h);
  click(h.mod.render(), 'pr-files-layout', h);
  tree = h.mod.render();
  assert.equal(find(tree, 'pr-folder-src'), undefined);
  assert.match(strings(find(tree, 'pr-file-src/a.go')), /a\.go src \+3 −1/);
  assert.equal(h.storage.get('files-layout'), 'flat');
});

test('moving to a tab with no terminal, such as a diff, keeps the PR instead of reading it again', () => {
  const h = harness();
  const space = (tab) => [{ id: 's', active: true, folder: '/home', branch: 'main', tabs: [{ id: 't1', active: tab === 't1' }, { id: 't2', active: tab === 't2' }] }];
  h.live.panes = [{ tab: 't1', cwd: '/repo', branch: 'fix' }, { tab: 't2', mod: 'better-changes' }];
  h.live.spaces = space('t1');
  h.tick();
  const key = h.mod.spaceKey;
  assert.match(key, /\/repo:fix/);
  h.live.spaces = space('t2');
  h.tick();
  assert.equal(h.mod.spaceKey, key);
});
