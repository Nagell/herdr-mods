const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'mods/github-pr');

test('package owns its helper and has no custom-mod or layout dependency', () => {
  const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /better-tabs|factory-tabs|herdr-workflow|center-body|panel-body|mods\/pull-requests/);
  assert.match(source, /appHome\(\)\}\/mods\/github-pr\/bin\/herdr-pr/);
  assert.match(source, /run\("tab.new"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'mod.json'))).title, 'GitHub PR');
  for (const file of ['main.js', 'typography.js', 'mod.json', 'pull-request.svg', 'merged.svg', 'draft.svg', 'closed.svg', 'github.svg', 'refresh.svg', 'back.svg', 'chevron-down.svg', 'check-success.svg', 'check-failure.svg', 'check-running.svg', 'check-pending.svg', 'check-skipped.svg', 'worktree.svg', 'terminal.svg', 'branch.svg', 'folder.svg', 'close.svg'])
    assert.ok(fs.existsSync(path.join(runtime, file)), file);
  for (const file of ['helper/go.mod', 'helper/main.go', 'helper/main_test.go', 'install.py', 'README.md', 'RECIPE.md'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
});
