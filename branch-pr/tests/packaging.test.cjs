const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/branch-pr');

test('package owns its helper and has no custom-mod or layout dependency', () => {
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /better-tabs|factory-tabs|herdr-workflow|center-body|panel-body|mods\/pull-requests/);
  assert.match(fs.readFileSync(path.join(runtime, 'github/reads.js'), 'utf8'), /appHome\(\)\}\/mods\/branch-pr\/bin\/herdr-pr/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'Branch PR');
  for (const file of ['main.js', 'settings.js', 'mod.json', 'views/ui.js', 'github/model.js', 'icons/pull-request.svg', 'icons/merged.svg', 'icons/draft.svg', 'icons/closed.svg', 'icons/github.svg'])
    assert.ok(fs.existsSync(path.join(runtime, file)), file);
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/main_test.go', 'install.py', 'README.md', 'RECIPE.md'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  // Every icon a view names exists, and every icon that exists is used.
  const code = ['main.js', ...['views', 'actions', 'github', 'state'].flatMap((d) => fs.readdirSync(path.join(runtime, d)).map((f) => `${d}/${f}`))].map((f) => fs.readFileSync(path.join(runtime, f), 'utf8')).join('\n');
  const icons = fs.readdirSync(path.join(runtime, 'icons')).map((f) => f.replace('.svg', ''));
  for (const icon of icons.filter((i) => !i.startsWith('check-')))
    assert.ok(code.includes(`"${icon}"`) || code.includes(`/${icon}.svg`), `unused icon ${icon}`);
  for (const [, name] of code.matchAll(/(?:icon: |Icon\()"([a-z-]+)"/g)) assert.ok(icons.includes(name), `missing icon ${name}`);
});

test('every name imported from another file of the mod is exported there', () => {
  const files = ['main.js', 'settings.js', ...['views', 'actions', 'github', 'state'].flatMap((d) => fs.readdirSync(path.join(runtime, d)).map((f) => `${d}/${f}`))];
  for (const file of files) {
    const code = fs.readFileSync(path.join(runtime, file), 'utf8');
    for (const [, names, from] of code.matchAll(/^import \{([^}]*)\} from "(\.[^"]+)";/gm)) {
      const target = fs.readFileSync(path.join(runtime, path.dirname(file), from), 'utf8');
      for (const name of names.split(',').map((n) => n.trim()).filter(Boolean))
        assert.match(target, new RegExp(`^export (async )?(function|const|class) ${name}\\b`, 'm'), `${file} imports ${name} from ${from}`);
    }
  }
});
