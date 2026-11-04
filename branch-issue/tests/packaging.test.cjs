const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/branch-issue');

test('package owns its helper and has no custom-mod or layout dependency', () => {
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /better-tabs|factory-tabs|herdr-workflow|center-body|panel-body|branch-pr/);
  assert.match(source, /appHome\(\)\}\/mods\/branch-issue\/bin\/herdr-linear/);
  assert.match(source, /run\("tab.new"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'Branch Issue');
  assert.equal(fs.readFileSync(path.join(runtime, 'typography.js'), 'utf8'), fs.readFileSync(path.join(root, '../branch-pr/mods/branch-pr/typography.js'), 'utf8'));
  for (const file of ['main.js', 'typography.js', 'mod.json', 'issue.svg', 'refresh.svg', 'back.svg', 'chevron-down.svg', 'checkout.svg', 'branch.svg', 'terminal.svg', 'comment.svg', 'close.svg', 'link.svg', 'unlink.svg', 'external.svg', 'user.svg'])
    assert.ok(fs.existsSync(path.join(runtime, file)), file);
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/main_test.go', 'install.py', 'README.md', 'RECIPE.md'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
});
