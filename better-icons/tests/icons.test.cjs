// The icon pack and its resolver, against the table generate.mjs wrote.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.join(__dirname, '../..');
const root = path.join(__dirname, '../mods/better-icons');
const table = JSON.parse(fs.readFileSync(path.join(root, 'icons.json'), 'utf8'));

function resolver(texts = {}, watch = () => new Promise(() => {})) {
  const source = fs.readFileSync(path.join(root, 'file-icons.js'), 'utf8')
    .replace(/^import\s+[\s\S]*?;$/gm, '')
    .replace(/^export /gm, '')
    + '\nObject.assign(globalThis, { fileIcon, isLight, loadFileIcons, followFileIcons });';
  const context = {
    appHome: () => '/app',
    readTextFile: async (p) => { if (texts[p] instanceof Error) throw texts[p]; return texts[p] ?? null; },
    watchFolder: (p) => watch(p),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}
const { fileIcon, isLight } = resolver();
const icon = (relative, options) => fileIcon(table, relative, options)?.replace(/^mods\/better-icons\/icons\/(.*)\.svg$/, '$1');

test('every icon the table names is in icons/, and nothing else is', () => {
  const named = new Set([table.file, table.folder, ...Object.keys(table.open), ...Object.values(table.open)]);
  for (const map of [table.fileNames, table.fileExtensions, table.folderNames, ...Object.values(table.light)])
    for (const name of Object.values(map)) named.add(name);
  const files = fs.readdirSync(path.join(root, 'icons'));
  assert.equal(files.length, 1184);
  assert.deepEqual(files.map((f) => f.replace(/\.svg$/, '')).sort(), [...named].sort());
  assert.equal(table.source, 'material-icon-theme 5.40.0');
});

test('every folder icon has an open one, and keys are lower case', () => {
  for (const map of [table.folderNames, table.light.folderNames])
    for (const name of Object.values(map)) assert.ok(table.open[name], name);
  assert.equal(table.open[table.folder], 'folder-open');
  for (const map of [table.fileNames, table.fileExtensions, table.folderNames, ...Object.values(table.light)])
    for (const key of Object.keys(map)) assert.equal(key, key.toLowerCase());
});

test('a file gets the icon for its name, else its longest extension, else the plain one', () => {
  assert.equal(icon('package.json'), 'nodejs');
  assert.equal(icon('Dockerfile'), 'docker');
  assert.equal(icon('README.MD'), 'readme');
  assert.equal(icon('src/main.ts'), 'typescript');
  assert.equal(icon('src/main.spec.ts'), 'test-ts');
  assert.equal(icon('notes.draft.md'), 'markdown');
  assert.equal(icon('notes.unknownext'), 'file');
  assert.equal(icon('LICENSE'), 'license');
});

test('a folder gets its own icon, open or shut, and a rule for a path beats its name', () => {
  assert.equal(icon('src', { dir: true }), 'folder-src');
  assert.equal(icon('src', { dir: true, open: true }), 'folder-src-open');
  assert.equal(icon('.github/workflows', { dir: true }), 'folder-gh-workflows');
  assert.equal(icon('app/.github/workflows', { dir: true }), 'folder-gh-workflows');
  assert.equal(icon('workflows', { dir: true }), 'folder');
  assert.equal(icon('/repo/.github/workflows', { dir: true }), 'folder-gh-workflows');
  assert.equal(icon('somewhere', { dir: true, open: true }), 'folder-open');
});

test('a light theme uses the light icon where there is one', () => {
  assert.equal(icon('vercel.json'), 'vercel');
  assert.equal(icon('vercel.json', { light: true }), 'vercel_light');
  assert.equal(icon('package.json', { light: true }), 'nodejs');
});

test('a theme is light when its background is', () => {
  for (const c of ['#ffffff', '#FAFAFA', '#fff', '#f5f5f5cc']) assert.equal(isLight(c), true, c);
  for (const c of ['#212121', '#000', '#1e1e2e', 'rgb(255,255,255)', '', undefined]) assert.equal(isLight(c), false, String(c));
});

test('without the table there is no icon, so the mod keeps its own', async () => {
  assert.equal(fileIcon(null, 'package.json'), null);
  const file = '/app/mods/better-icons/icons.json';
  assert.equal(await resolver({}).loadFileIcons(), null);
  assert.equal(await resolver({ [file]: 'not json' }).loadFileIcons(), null);
  assert.equal(await resolver({ [file]: new Error('gone') }).loadFileIcons(), null);
  assert.equal(await resolver({ [file]: '{}' }).loadFileIcons(), null);
  const { file: _f, ...noPlain } = table;
  assert.equal(await resolver({ [file]: JSON.stringify(noPlain) }).loadFileIcons(), null);
  assert.equal((await resolver({ [file]: JSON.stringify(table) }).loadFileIcons()).folder, 'folder');
});

test('a table once read is kept, a miss is not', async () => {
  const file = '/app/mods/better-icons/icons.json';
  const texts = {};
  const r = resolver(texts);
  assert.equal(await r.loadFileIcons(), null);
  texts[file] = JSON.stringify(table);
  const first = await r.loadFileIcons();
  assert.equal(first.folder, 'folder');
  delete texts[file];
  assert.equal(await r.loadFileIcons(), first);
});

test('no path rule is longer than the resolver tries', () => {
  for (const map of [table.fileNames, table.folderNames, ...Object.values(table.light)])
    for (const key of Object.keys(map)) assert.ok(key.split('/').length <= 2, key);
});

test('a reread drops a table that is gone, and a new object means a change', async () => {
  const file = '/app/mods/better-icons/icons.json';
  const texts = { [file]: JSON.stringify(table) };
  const r = resolver(texts);
  const first = await r.loadFileIcons();
  assert.equal(await r.loadFileIcons(), first, 'nothing changed, same object');
  const updated = await r.loadFileIcons(true);
  assert.notEqual(updated, first, 'a reread is a new object');
  delete texts[file];
  assert.equal(await r.loadFileIcons(), updated, 'kept without a reread');
  assert.equal(await r.loadFileIcons(true), null);
});

test('every view following the icons redraws on an update, and a failed watch falls back to a timer', async () => {
  const file = '/app/mods/better-icons/icons.json';
  const texts = { [file]: JSON.stringify(table) };
  const waiting = [];
  let fail = false;
  const r = resolver(texts, () => (fail ? Promise.reject(new Error('gone')) : new Promise((resolve) => waiting.push(resolve))));
  const after = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const view = () => {
    const v = { notified: 0 };
    const cx = { notify: () => v.notified++, spawn: (fn) => fn(cx), timer: { after: (_ms, fn) => after.push(fn) } };
    r.followFileIcons(v, cx);
    return v;
  };
  const sidebar = view();
  const viewer = view();
  await settle();
  const first = sidebar.fileIcons;
  assert.equal(first.folder, 'folder');
  assert.equal(sidebar.notified, 1);
  texts[file] = JSON.stringify({ ...table, folder: 'folder-src' });
  waiting.splice(0).forEach((resolve) => resolve([]));
  await settle();
  assert.equal(viewer.fileIcons.folder, 'folder-src');
  assert.equal(sidebar.fileIcons.folder, 'folder-src');
  assert.equal(sidebar.notified, 2, 'the second view still redraws');
  fail = true;
  delete texts[file];
  waiting.splice(0).forEach((resolve) => resolve([]));
  await settle();
  assert.equal(sidebar.fileIcons, null, 'uninstalled: plain icons again');
  assert.ok(after.length > 0, 'waiting on the timer instead');
  fail = false;
  texts[file] = JSON.stringify(table);
  after.splice(0).forEach((fn) => fn());
  await settle();
  assert.equal(sidebar.fileIcons.folder, 'folder', 'back after the timer');
});

test('every mod that shows these icons carries the same resolver', () => {
  const canonical = fs.readFileSync(path.join(root, 'file-icons.js'), 'utf8');
  const copies = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'file-icons.js') copies.push(full);
    }
  };
  walk(repo);
  assert.ok(copies.some((f) => f.includes(`${path.sep}better-files${path.sep}`)), 'Better Files has a copy');
  for (const copy of copies) assert.equal(fs.readFileSync(copy, 'utf8'), canonical, path.relative(repo, copy));
});

test('the pack ships the icons\' licence and docks nowhere', () => {
  assert.match(fs.readFileSync(path.join(root, 'LICENSE-material-icon-theme.txt'), 'utf8'), /^The MIT License \(MIT\)\nCopyright \(c\) 2025 Material Extensions/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mod.json'), 'utf8'));
  assert.equal(manifest.place, 'none');
  assert.equal(manifest.title, 'Better Icons');
});
