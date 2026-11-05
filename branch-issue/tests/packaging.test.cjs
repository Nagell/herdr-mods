const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/branch-issue');

const files = () => ['main.js', 'settings.js', ...['views', 'actions', 'linear', 'state'].flatMap((d) => fs.readdirSync(path.join(runtime, d)).map((f) => `${d}/${f}`))];

test('package owns its helper and has no custom-mod or layout dependency', () => {
  const code = files().map((f) => fs.readFileSync(path.join(runtime, f), 'utf8')).join('\n');
  assert.doesNotMatch(code, /better-tabs|factory-tabs|herdr-workflow|center-body|panel-body|branch-pr/);
  assert.match(fs.readFileSync(path.join(runtime, 'linear/reads.js'), 'utf8'), /appHome\(\)\}\/mods\/branch-issue\/bin\/herdr-linear/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'Branch Issue');
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/main_test.go', 'install.py', 'README.md', 'RECIPE.md'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  const icons = fs.readdirSync(path.join(runtime, 'icons')).map((f) => f.replace('.svg', ''));
  for (const icon of icons) assert.ok(code.includes(`"${icon}"`), `unused icon ${icon}`);
  for (const [, name] of code.matchAll(/(?:icon: |Icon\()"([a-z-]+)"/g)) assert.ok(icons.includes(name), `missing icon ${name}`);
});

test('every name imported from another file of the mod is exported there', () => {
  for (const file of files()) {
    const code = fs.readFileSync(path.join(runtime, file), 'utf8');
    for (const [, names, from] of code.matchAll(/^import \{([^}]*)\} from "(\.[^"]+)";/gm)) {
      const target = fs.readFileSync(path.join(runtime, path.dirname(file), from), 'utf8');
      for (const name of names.split(',').map((n) => n.trim()).filter(Boolean))
        assert.match(target, new RegExp(`^export (async )?(function|const|class) ${name}\\b`, 'm'), `${file} imports ${name} from ${from}`);
    }
  }
});
