const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// settings.js is shared by every mod; the harness here is the only test of it.
const context = { readTextFile: async () => null, appHome: () => '/app' };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../mods/branch-pr/settings.js'), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export async function', 'async function'), context);
const { duration, size, mergeSettings } = context;
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b)); // values cross the vm boundary

test('durations and sizes accept units or plain numbers and fall back otherwise', () => {
  assert.equal(duration('450ms', 1), 450); assert.equal(duration('60s', 1), 60000); assert.equal(duration('1.5m', 1), 90000); assert.equal(duration(7, 1), 7);
  assert.equal(duration('soon', 9), 9); assert.equal(duration(-1, 9), 9); assert.equal(duration(0, 9), 9); assert.equal(duration('0s', 9), 9);
  assert.equal(size('60KB', 1), 61440); assert.equal(size('2mb', 1), 2097152); assert.equal(size(10, 1), 10); assert.equal(size('big', 3), 3);
});

test('merge keeps defaults for unknown keys and wrong types, and reports them', () => {
  const defaults = { refresh: { every: '60s' }, list: { page_size: 25 }, flag: true };
  const problems = [];
  const merged = mergeSettings(defaults, { refresh: { every: 5, later: 1 }, list: 'no', flag: 'yes', extra: {} }, problems);
  same(merged, { refresh: { every: 5 }, list: { page_size: 25 }, flag: true });
  same(problems, ['refresh.later is not a setting', 'list must be an object', 'flag should be a boolean', 'extra is not a setting']);
  same(mergeSettings(defaults, undefined, []), defaults);
});

test('loadSettings reports an unreadable mod.json and keeps defaults', async () => {
  context.readTextFile = async () => { throw new Error('missing'); };
  const { settings, problems } = await context.loadSettings('x', { a: 1 });
  same(settings, { a: 1 }); assert.match(problems[0], /could not be read: missing/);
  context.readTextFile = async () => JSON.stringify({ settings: { a: 2 } });
  assert.equal((await context.loadSettings('x', { a: 1 })).settings.a, 2);
});
