const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
// Execute the mod in a VM with a small Herdr/GPUI stand-in. The queued spawn
// promises let tests control async Git responses without launching the app.
function harness(mode = "sidebar") {
  const pending = [],
    values = {},
    calls = [],
    commands = [],
    live = { spaces: [], panes: [] };
  // Fluent GPUI builders become inspectable nodes and event handlers.
  function el() {
    const data = { nodes: [], handlers: {} };
    let proxy;
    proxy = new Proxy(data, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "child" || k === "content" || k === "trigger")
          return (c) => {
            t.nodes.push(c);
            return proxy;
          };
        if (k === "children")
          return (cs) => {
            t.nodes.push(...cs);
            return proxy;
          };
        if (k === "when")
          return (b, f) => {
            if (b) f(proxy);
            return proxy;
          };
        return (...a) => {
          if (k === "id") t.id = a[0];
          if (k.startsWith("on_")) t.handlers[k.slice(3)] = a.at(-1);
          return proxy;
        };
      },
    });
    return proxy;
  }
  const state = () => ({
    text: "",
    value() {
      return this.text;
    },
    set_value(v) {
      this.text = v;
    },
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
    },
  });
  const cx = {
    stop_propagation() {},
    notify() {},
    focus_handle: () => ({ focus() {} }),
    timer: { every() {} },
    spawn(fn) {
      pending.push(fn(cx));
    },
  };
  const context = {
    View: class {},
    div: el,
    svg: el,
    v_flex: el,
    h_flex: el,
    TextareaState: { new: state },
    Textarea: {
      new: () => {
        const node = el();
        node.type = "textarea";
        return node;
      },
    },
    Popover: { new: (id) => el().id(id) },
    Scrollbar: { vertical: el },
    v_virtual_list: () => el(),
    spaces: () => live.spaces,
    panes: () => live.panes,
    focused: () => null,
    props: () => ({ mode }),
    theme: () => ({}),
    settings: () => ({ font_size: 14, font_family: "Configured code" }),
    localStorage: { getItem: () => null, setItem() {} },
    shared: (k) => values[k],
    setShared: (k, v) => (values[k] = v),
    layout: () => ({
      id: "center-body",
      type: "stack",
      active: "main",
      children: [{ id: "main" }, { id: "file-diff" }],
    }),
    run: (cmd, args) => commands.push({ cmd, args }),
    nextCommand: () => new Promise(() => {}),
    watchFolder: async () => {
      throw Error("test");
    },
    readTextFile: async () => null,
    exec: async (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return { code: 0, stdout: "" };
    },
  };
  vm.createContext(context);
  for (const file of ["typography.js", "settings.js", "model.js", "main.js"])
    vm.runInContext(
      fs
        .readFileSync(`mods/better-changes/${file}`, "utf8")
        .replace(/^import\s+[\s\S]*?;\n/gm, "")
        .replaceAll("export async function", "async function")
        .replaceAll("export function", "function")
        .replace("export default class Changes", "globalThis.Changes=class Changes"),
      context,
    );
  const mod = new context.Changes();
  mod.init({}, cx);
  pending.length = 0;
  live.spaces = [{ id: "s", active: true, folder: "/repo", tabs: [{ id: "t", active: true }] }];
  live.panes = [{ tab: "t", cwd: "/repo", focused: true }];
  mod.context = JSON.stringify({ cwd: "/repo", on: null });
  mod.root = "/repo";
  mod.on = null;
  mod.hasHead = true;
  return {
    mod,
    cx,
    context,
    values,
    calls,
    commands,
    live,
    flush: async () => {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}
function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.nodes ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
}
const files = [
  {
    path: "src/app.js",
    status: "M",
    add: 2,
    del: 1,
    staged: false,
    unstaged: true,
    unstagedStats: { add: 2, del: 1 },
  },
  {
    path: "src/lib/new.js",
    status: "A",
    fresh: true,
    add: 0,
    del: 0,
    staged: false,
    unstaged: true,
  },
  {
    path: "README.md",
    status: "M",
    add: 1,
    del: 0,
    staged: true,
    unstaged: false,
    stagedStats: { add: 1, del: 0 },
  },
];
test("porcelain and numstat preserve special filenames, conflicts, deletions and binary changes", () => {
  const h = harness();
  h.context.status =
    " M path with spaces\0?? nested/new\tname\0UU conflict\0 D deleted\0 M image.png\0";
  h.context.stats = ["2\t3\tpath with spaces\0-\t-\timage.png\0"];
  const parsed = vm.runInContext("changedFiles(status,stats)", h.context);
  assert.equal(parsed.find((f) => f.path === "path with spaces").del, 3);
  assert.equal(parsed.find((f) => f.path === "nested/new\tname").fresh, true);
  assert.equal(parsed.find((f) => f.path === "conflict").status, "U");
  assert.equal(parsed.find((f) => f.path === "deleted").status, "D");
  assert.equal(parsed.find((f) => f.path === "image.png").binary, true);
});
test("statistics treat object-property filenames as ordinary paths", () => {
  const h = harness();
  const names = ["constructor", "toString", "__proto__"];
  h.context.status = names.map((name) => `?? ${name}\0`).join("");
  h.context.stats = ["", ""];
  let parsed = vm.runInContext("changedFiles(status, stats)", h.context);
  for (const file of parsed) {
    assert.equal(file.add, 0, file.path);
    assert.equal(file.del, 0, file.path);
  }

  // Exercise both missing-key fallback and stored statistics for these names.
  h.context.status = names.map((name) => `MM ${name}\0`).join("");
  h.context.stats = [
    names.map((name) => `2\t3\t${name}\0`).join(""),
    names.map((name) => `4\t5\t${name}\0`).join(""),
  ];
  parsed = vm.runInContext("changedFiles(status, stats)", h.context);
  for (const file of parsed) {
    assert.equal(file.stagedStats.add, 2, file.path);
    assert.equal(file.unstagedStats.del, 5, file.path);
    assert.equal(file.add, 6, file.path);
    assert.equal(file.del, 8, file.path);
  }
});

test("tree groups directories and collapsed folders hide descendants", () => {
  const h = harness();
  h.context.files = files;
  const tree = vm.runInContext("fileTree(files)", h.context);
  assert.equal(tree[0].kind, "folder");
  assert.equal(tree[0].path, "src");
  assert.equal(tree.find((r) => r.file?.path === "src/lib/new.js").depth, 2);
  const collapsed = vm.runInContext('fileTree(files,new Set(["src"]))', h.context);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[1].file.path, "README.md");
});
test("diff rows preserve old and new line numbers through additions and deletions", () => {
  const h = harness();
  h.context.lines = [
    "@@ -3,2 +3,2 @@",
    " old",
    "-removed",
    "+added",
    "\\ No newline at end of file",
  ];
  const rows = vm.runInContext("diffRows(lines)", h.context);
  assert.equal(rows[1].old, 3);
  assert.equal(rows[1].next, 3);
  assert.equal(rows[2].old, 4);
  assert.equal(rows[2].next, undefined);
  assert.equal(rows[3].next, 4);
});
test("sidebar toggles tree and flat views and opens selected file in the center without inline diff", () => {
  const h = harness();
  h.mod.files = files;
  h.mod.total = 3;
  let rendered = h.mod.render(h.cx);
  assert.ok(find(rendered, "changes-folder-unstaged-src"));
  assert.equal(find(rendered, "factory-diff-x"), undefined);
  find(rendered, "changes-flat").handlers.click({}, h.cx);
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "changes-folder-unstaged-src"), undefined);
  find(rendered, "change-unstaged-src/app.js").handlers.click({}, h.cx);
  assert.equal(h.values["better-changes.selection"].path, "src/app.js");
  assert.equal(h.commands[0].cmd, "tab.new");
  assert.equal(h.commands[0].args.name, "app.js");
  assert.equal(h.commands[0].args.mod, "better-changes");
  assert.equal(h.commands[1].args.child, "main");
});
test("center diff runs readonly Git on the space machine and close targets its own tab", async () => {
  const h = harness("diff");
  h.mod.files = files;
  h.mod.on = "remote";
  h.values["better-changes.selection"] = {
    context: h.mod.context,
    path: "src/app.js",
    previous: "main",
  };
  h.context.exec = async (cmd, args, options) => {
    h.calls.push({ cmd, args, options });
    return {
      code: 0,
      stdout: "diff --git a/src/app.js b/src/app.js\n@@ -1 +1 @@\n-before\n+after\n",
    };
  };
  h.mod.syncSelection(h.cx);
  await h.flush();
  assert.equal(h.mod.rows.length, 3);
  assert.equal(h.calls[0].options.on, "remote");
  assert.ok(h.calls[0].args.includes("--no-ext-diff"));
  assert.ok(h.calls[0].args.includes("--no-textconv"));
  const rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "changes-list"), undefined);
  assert.ok(find(rendered, "factory-diff-x"));
  h.mod.diffSpace = "s";
  h.live.spaces[0].tabs.push({ id: "diff" });
  h.live.panes.push({ tab: "diff", mod: "better-changes" });
  find(rendered, "diff-close").handlers.click({}, h.cx);
  assert.equal(h.commands[0].cmd, "tab.close");
  assert.equal(h.commands[0].args.id, "diff");
});
test("late diff responses cannot replace another selected file", async () => {
  const h = harness("diff");
  h.mod.files = files;
  let finish;
  h.context.exec = () => new Promise((resolve) => (finish = resolve));
  h.mod.path = "src/app.js";
  h.mod.loadDiff(h.cx);
  h.mod.path = "src/lib/new.js";
  h.context.readTextFile = async () => "new content\n";
  h.mod.loadDiff(h.cx);
  finish({ code: 0, stdout: "@@ -1 +1 @@\n-old\n+stale\n" });
  await h.flush();
  assert.ok(h.mod.rows.some((r) => r.text === "new content"));
  assert.ok(!h.mod.rows.some((r) => r.text === "stale"));
});
test("binary and empty new files have explicit previews; changing context clears old selection", async () => {
  const h = harness("diff");
  h.mod.files = files;
  h.mod.path = "src/lib/new.js";
  h.context.readTextFile = async () => "";
  h.mod.loadDiff(h.cx);
  await h.flush();
  assert.equal(h.mod.rows[0].text, "Empty new file");
  h.context.readTextFile = async () => "bin\0data";
  h.mod.loadDiff(h.cx);
  await h.flush();
  assert.match(h.mod.rows[0].text, /Binary/);
  h.values["better-changes.selection"] = { context: "another-space", path: "secret" };
  h.mod.syncSelection(h.cx);
  assert.equal(h.mod.path, null);
  assert.equal(h.mod.rows.length, 0);
});
test("partial staging keeps distinct index and working tree statistics and conflicts stay unstaged", () => {
  const h = harness();
  h.context.status = "MM partial\0A  added\0 D deleted\0?? fresh\0UU conflict\0";
  h.context.stats = ["1\t1\tpartial\0", "2\t3\tpartial\0"];
  const result = vm.runInContext("changedFiles(status,stats)", h.context),
    partial = result.find((f) => f.path === "partial");
  assert.equal(partial.staged, true);
  assert.equal(partial.unstaged, true);
  assert.equal(partial.stagedStats.add, 1);
  assert.equal(partial.unstagedStats.add, 2);
  assert.equal(result.find((f) => f.path === "fresh").staged, false);
  assert.equal(result.find((f) => f.path === "added").unstaged, false);
  assert.equal(result.find((f) => f.path === "conflict").staged, false);
  assert.equal(result.find((f) => f.path === "conflict").conflict, true);
});
test("file and bulk index actions use literal paths, keep remote context, and avoid opening a diff", async () => {
  for (const [action, path, head, expected] of [
    ["stage", "src/app.js", true, ["--literal-pathspecs", "add", "--", "src/app.js"]],
    [
      "unstage",
      "README.md",
      true,
      ["--literal-pathspecs", "reset", "-q", "HEAD", "--", "README.md"],
    ],
    ["stage", null, true, ["add", "-A"]],
    ["unstage", null, true, ["--literal-pathspecs", "reset", "-q", "HEAD", "--", "."]],
    [
      "unstage",
      "README.md",
      false,
      ["--literal-pathspecs", "rm", "--cached", "-r", "-f", "--", "README.md"],
    ],
  ]) {
    const h = harness();
    h.mod.files = files;
    h.mod.on = "remote";
    h.mod.hasHead = head;
    h.mod.refresh = () => {};
    h.mod.indexAction(action, path, h.cx);
    h.mod.indexAction(action, path, h.cx);
    await h.flush();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(Array.from(h.calls[0].args.slice(5)), expected);
    assert.equal(h.calls[0].options.on, "remote");
    assert.equal(h.commands.length, 0);
    assert.equal(h.mod.busy, false);
    assert.ok(h.values["better-changes.reload"]);
  }
});
test("staging failure retains the commit message and unlocks controls", async () => {
  const h = harness();
  h.mod.files = files;
  h.mod.message = "Keep message";
  h.mod.refresh = () => {};
  h.context.exec = async () => ({ code: 128, stderr: "index.lock exists" });
  h.mod.indexAction("stage", "src/app.js", h.cx);
  await h.flush();
  assert.match(h.mod.note, /Stage failed: index.lock/);
  assert.equal(h.mod.message, "Keep message");
  assert.equal(h.mod.busy, false);
  assert.equal(h.values["better-changes.reload"], undefined);
});
test("commit writes only the staged index and refuses empty staging or conflicts", async () => {
  const h = harness();
  h.mod.message = "Commit staged work";
  h.mod.refresh = () => {};
  h.mod.commit(h.cx);
  await h.flush();
  assert.equal(h.calls.length, 0);
  h.mod.stagedCount = 1;
  h.mod.conflicts = true;
  h.mod.commit(h.cx);
  await h.flush();
  assert.equal(h.calls.length, 0);
  h.mod.conflicts = false;
  h.mod.commit(h.cx);
  await h.flush();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(Array.from(h.calls[0].args.slice(5)), ["commit", "-m", "Commit staged work"]);
  assert.equal(h.mod.message, "");
});
test("commit footer has a multiline editor and mode selection never executes a commit", async () => {
  const h = harness();
  h.mod.commitMenuOpen = true;
  h.context.exec = async (_cmd, args) => {
    h.calls.push({ args });
    return { code: 0, stdout: `${"a".repeat(40)}\0Previous title\n\nPrevious body\n\n` };
  };
  const footer = h.mod.renderCommitFooter({});
  assert.equal(find(footer, "changes-commit-message").type, "textarea");
  assert.equal(h.mod.input.handlers.submit, undefined, "Enter must not submit a commit");
  assert.ok(find(footer, "changes-mode-commit"));
  find(footer, "changes-mode-amend").handlers.click({}, h.cx);
  await h.flush();
  assert.equal(h.mod.commitMode, "amend");
  assert.equal(h.mod.commitMenuOpen, false);
  assert.equal(h.mod.message, "Previous title\n\nPrevious body");
  assert.equal(h.mod.input.value(), h.mod.message);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.includes("commit"), false);
  assert.equal(h.mod.canCommit(), true, "message-only amend is allowed");

  h.mod.hasHead = false;
  h.mod.commitMenuOpen = true;
  assert.equal(find(h.mod.renderCommitFooter({}), "changes-mode-amend").handlers.click, undefined);
  assert.equal(h.mod.canCommit(), false);
});

test("preparing amend preserves drafts and ignores superseded responses", async () => {
  const h = harness();
  let resolve;
  h.context.exec = () =>
    new Promise((done) => {
      resolve = done;
    });
  h.mod.setCommitMode("amend", h.cx);
  assert.equal(h.mod.canCommit(), false);
  h.mod.input.set_value("Typed while loading\n\nKeep this body");
  h.mod.input.handlers.change({}, h.cx);
  resolve({ code: 0, stdout: `${"a".repeat(40)}\0Old message\n` });
  await h.flush();
  assert.equal(h.mod.message, "Typed while loading\n\nKeep this body");

  h.mod.setCommitMode("amend", h.cx);
  h.mod.setCommitMode("commit", h.cx);
  resolve({ code: 0, stdout: `${"b".repeat(40)}\0Stale message\n` });
  await h.flush();
  assert.equal(h.mod.commitMode, "commit");
  assert.equal(h.mod.amendHead, null);
  assert.equal(h.mod.amendLoading, false);
  assert.equal(h.mod.message, "Typed while loading\n\nKeep this body");
});

test("amend refuses missing HEAD, conflicts, and a changed latest commit", async () => {
  const h = harness();
  h.mod.refresh = () => {};
  h.mod.hasHead = false;
  h.mod.setCommitMode("amend", h.cx);
  assert.equal(h.mod.commitMode, "commit");
  assert.equal(h.calls.length, 0);

  h.mod.hasHead = true;
  h.context.exec = async (_cmd, args) => {
    h.calls.push({ args });
    return {
      code: 0,
      stdout: args.includes("log") ? `${"a".repeat(40)}\0Old message\n` : `${"b".repeat(40)}\n`,
    };
  };
  h.mod.setCommitMode("amend", h.cx);
  await h.flush();
  h.mod.conflicts = true;
  h.mod.commit(h.cx);
  assert.equal(h.calls.length, 1);
  h.mod.conflicts = false;
  h.mod.commit(h.cx);
  await h.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(
    h.calls.some((call) => call.args.includes("commit")),
    false,
  );
  assert.match(h.mod.note, /Latest commit changed/);
  assert.equal(h.mod.message, "Old message");
  assert.equal(h.mod.busy, false);
});

test("failed amend retains multiline text and releases its busy state", async () => {
  const h = harness();
  h.mod.refresh = () => {};
  h.context.exec = async (_cmd, args) => {
    if (args.includes("log")) return { code: 0, stdout: `${"a".repeat(40)}\0Title\n\nBody\n` };
    if (args.includes("rev-parse")) return { code: 0, stdout: "a".repeat(40) };
    return { code: 1, stderr: "Commit hook rejected the message" };
  };
  h.mod.setCommitMode("amend", h.cx);
  await h.flush();
  h.mod.commit(h.cx);
  await h.flush();
  assert.equal(h.mod.message, "Title\n\nBody");
  assert.match(h.mod.note, /Amend failed: Commit hook rejected/);
  assert.equal(h.mod.commitMode, "amend");
  assert.equal(h.mod.busy, false);
});

test("commit dropdown supports keyboard mode selection without writing Git", () => {
  const h = harness();
  const trigger = find(h.mod.renderCommitFooter({}), "changes-commit-options");
  trigger.handlers.key_down({ key: "down" }, h.cx);
  assert.equal(h.mod.commitMenuOpen, true);
  const menu = find(h.mod.renderCommitFooter({}), "changes-commit-menu");
  menu.handlers.key_down({ key: "down" }, h.cx);
  assert.equal(h.mod.commitMenuIndex, 1);
  menu.handlers.key_down({ key: "escape" }, h.cx);
  assert.equal(h.mod.commitMenuOpen, false);
  assert.equal(h.calls.length, 0);
});

test("staged and unstaged entries render separately and select the correct diff version", async () => {
  const h = harness();
  h.mod.files = [{ ...files[0], staged: true, unstaged: true }];
  h.mod.stagedCount = 1;
  h.mod.unstagedCount = 1;
  const rendered = h.mod.render(h.cx);
  assert.ok(find(rendered, "change-staged-src/app.js"));
  assert.ok(find(rendered, "change-unstaged-src/app.js"));
  find(rendered, "change-staged-src/app.js").handlers.click({}, h.cx);
  assert.equal(h.values["better-changes.selection"].scope, "staged");
  const d = harness("diff");
  d.mod.files = h.mod.files;
  d.mod.path = "src/app.js";
  d.context.exec = async (cmd, args, options) => {
    d.calls.push({ cmd, args, options });
    return { code: 0, stdout: "@@ -1 +1 @@\n-old\n+new\n" };
  };
  d.mod.scope = "staged";
  d.mod.loadDiff(d.cx);
  await d.flush();
  assert.ok(d.calls[0].args.includes("--cached"));
  d.mod.scope = "unstaged";
  d.mod.loadDiff(d.cx);
  await d.flush();
  assert.ok(!d.calls[1].args.includes("--cached"));
  assert.ok(!d.calls[1].args.includes("HEAD"));
});
test("diff previews use literal filenames for every scope in real Git", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const cp = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-literal-diff-"));
  const git = (args) => cp.execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const selected = "[sample].txt";
  const unrelated = "s.txt"; // Matches the selected name if treated as a pattern.
  try {
    git(["init", "-q"]);
    for (const name of [selected, unrelated]) fs.writeFileSync(path.join(dir, name), "before\n");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "baseline",
    ]);
    fs.writeFileSync(path.join(dir, selected), "selected staged\n");
    fs.writeFileSync(path.join(dir, unrelated), "unrelated staged\n");
    git(["add", "."]);
    fs.writeFileSync(path.join(dir, selected), "selected working\n");
    fs.writeFileSync(path.join(dir, unrelated), "unrelated working\n");

    const h = harness("diff");
    h.live.spaces[0].folder = dir;
    h.live.panes[0].cwd = dir;
    h.mod.context = JSON.stringify({ cwd: dir, on: null });
    h.mod.root = dir;
    h.mod.path = selected;
    h.mod.files = [{ path: selected, status: "M", staged: true, unstaged: true }];
    h.context.exec = async (_cmd, args) => ({ code: 0, stdout: git(args) });
    for (const scope of ["staged", "unstaged", "all"]) {
      h.mod.scope = scope;
      h.mod.loadDiff(h.cx);
      await h.flush();
      assert.equal(h.mod.note, null, scope);
      assert.ok(
        h.mod.rows.some((row) => row.text.startsWith("selected")),
        scope,
      );
      assert.ok(!h.mod.rows.some((row) => row.text.includes("unrelated")), scope);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("initial staging and unstaging preserve working files and literal filenames in real Git", async () => {
  const os = require("node:os"),
    path = require("node:path"),
    cp = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-stage-"));
  const git = (args) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["init", "-q"]);
    const filename = "[sample].txt";
    fs.writeFileSync(path.join(dir, filename), "original\n");
    fs.writeFileSync(path.join(dir, "s.txt"), "other\n");
    const h = harness();
    h.live.spaces[0].folder = dir;
    h.live.panes[0].cwd = dir;
    h.mod.context = JSON.stringify({ cwd: dir, on: null });
    h.mod.root = dir;
    h.mod.hasHead = false;
    h.mod.refresh = () => {};
    h.mod.files = [{ path: filename, unstaged: true, staged: true }];
    h.context.exec = async (cmd, args) => {
      try {
        return { code: 0, stdout: git(args) };
      } catch (e) {
        return { code: e.status, stderr: e.stderr.toString() };
      }
    };
    h.mod.indexAction("stage", filename, h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(git(["ls-files"]).trim(), filename);
    fs.writeFileSync(path.join(dir, filename), "working edits\n");
    h.mod.indexAction("unstage", filename, h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(git(["ls-files"]).trim(), "");
    assert.equal(fs.readFileSync(path.join(dir, filename), "utf8"), "working edits\n");
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["add", "--", filename]);
    git(["commit", "-qm", "baseline"]);
    fs.writeFileSync(path.join(dir, filename), "staged version\n");
    git(["add", "--", filename]);
    fs.writeFileSync(path.join(dir, filename), "unstaged version\n");
    h.mod.hasHead = true;
    h.mod.stagedCount = 1;
    h.mod.message = "Commit index only";
    h.mod.commit(h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(git(["show", `HEAD:${filename}`]), "staged version\n");
    assert.equal(fs.readFileSync(path.join(dir, filename), "utf8"), "unstaged version\n");
    h.mod.indexAction("stage", filename, h.cx);
    await h.flush();
    h.mod.indexAction("unstage", filename, h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(git(["diff", "--cached"]), "");
    assert.equal(fs.readFileSync(path.join(dir, filename), "utf8"), "unstaged version\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("amend rewrites only the last commit, preserves unstaged edits, and supports message-only changes in real Git", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const cp = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-amend-"));
  const git = (args) =>
    cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["init", "-q"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.hooksPath", path.join(dir, "no-hooks")]);
    fs.writeFileSync(path.join(dir, "file.txt"), "baseline\n");
    git(["add", "."]);
    git(["commit", "-qm", "First"]);
    const parent = git(["rev-parse", "HEAD"]).trim();
    fs.writeFileSync(path.join(dir, "file.txt"), "second\n");
    git(["add", "."]);
    git(["commit", "-qm", "Second title\n\nSecond body"]);
    const previousHead = git(["rev-parse", "HEAD"]).trim();
    fs.writeFileSync(path.join(dir, "file.txt"), "staged version\n");
    git(["add", "."]);
    fs.writeFileSync(path.join(dir, "file.txt"), "unstaged version\n");

    const h = harness();
    h.live.spaces[0].folder = dir;
    h.live.panes[0].cwd = dir;
    h.mod.context = JSON.stringify({ cwd: dir, on: null });
    h.mod.root = dir;
    h.mod.refresh = () => {};
    h.mod.stagedCount = 1;
    h.context.exec = async (_cmd, args) => {
      try {
        return { code: 0, stdout: git(args) };
      } catch (error) {
        return { code: error.status, stderr: error.stderr.toString() };
      }
    };
    h.mod.setCommitMode("amend", h.cx);
    await h.flush();
    assert.equal(h.mod.message, "Second title\n\nSecond body");
    assert.equal(h.mod.amendHead, previousHead);
    h.mod.message = "Amended title\n\nBody line 1\nBody line 2";
    h.mod.commit(h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(h.mod.commitMode, "commit");
    assert.notEqual(git(["rev-parse", "HEAD"]).trim(), previousHead);
    assert.equal(git(["rev-parse", "HEAD^"]).trim(), parent);
    assert.equal(git(["rev-list", "--count", "HEAD"]).trim(), "2");
    assert.equal(
      git(["log", "-1", "--format=%B"]).trimEnd(),
      "Amended title\n\nBody line 1\nBody line 2",
    );
    assert.equal(git(["show", "HEAD:file.txt"]), "staged version\n");
    assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "unstaged version\n");
    assert.equal(git(["diff", "--cached"]), "");

    h.mod.stagedCount = 0;
    h.mod.setCommitMode("amend", h.cx);
    await h.flush();
    h.mod.message = "Message-only amend\n\nA new explanation.";
    assert.equal(h.mod.canCommit(), true);
    h.mod.commit(h.cx);
    await h.flush();
    assert.equal(h.mod.note, null);
    assert.equal(git(["rev-list", "--count", "HEAD"]).trim(), "2");
    assert.equal(
      git(["log", "-1", "--format=%B"]).trimEnd(),
      "Message-only amend\n\nA new explanation.",
    );
    assert.equal(fs.readFileSync(path.join(dir, "file.txt"), "utf8"), "unstaged version\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("different files reuse and rename the same diff tab, and closing permits a replacement", () => {
  const h = harness();
  h.mod.files = files;
  h.mod.pick(files[0], h.cx, "unstaged");
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 1);
  h.live.spaces[0].tabs.push({ id: "diff", name: "app.js" });
  h.live.panes.push({ tab: "diff", mod: "better-changes" });
  h.mod.pick(files[2], h.cx, "staged");
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 1);
  assert.ok(
    h.commands.some(
      (c) => c.cmd === "tab.rename" && c.args.id === "diff" && c.args.name === "README.md",
    ),
  );
  assert.ok(h.commands.some((c) => c.cmd === "tab.select" && c.args.id === "diff"));
  h.live.spaces[0].tabs = h.live.spaces[0].tabs.filter((t) => t.id !== "diff");
  h.live.panes = h.live.panes.filter((p) => p.tab !== "diff");
  h.mod.pick(files[0], h.cx, "unstaged");
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 2);
});
test("rapid file picks while a diff tab is opening create only one tab and keep the latest file", () => {
  const h = harness();
  h.mod.pick(files[0], h.cx);
  h.mod.pick(files[2], h.cx);
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 1);
  assert.equal(h.values["better-changes.diff-tabs"].s.selection.path, "README.md");
});
test("a diff tab pins its source directory when the mod tab has no terminal cwd or another space is selected", () => {
  const h = harness("diff");
  h.mod.diffSpace = "s";
  h.mod.source = { cwd: "/original", on: "remote" };
  h.values["better-changes.diff-tabs"] = {
    s: {
      source: { cwd: "/repo", on: null },
      selection: { context: h.mod.context, path: "README.md" },
    },
  };
  h.live.spaces[0].tabs = [{ id: "diff", active: true }];
  h.live.panes = [{ tab: "diff", mod: "better-changes", cwd: null }];
  assert.equal(vm.runInContext("location().cwd", h.context), "/repo");
  assert.equal(h.mod.location().cwd, "/repo");
  h.live.spaces = [{ id: "other", active: true, folder: "/other", tabs: [] }];
  assert.equal(h.mod.location().cwd, "/repo");
  assert.equal(h.mod.currentSelection().path, "README.md");
});
test("split diff aligns replacement blocks and preserves context and hunk boundaries", () => {
  const h = harness();
  h.context.lines = [
    "@@ -1,4 +1,3 @@",
    " same",
    "-old one",
    "-old two",
    "+new one",
    " tail",
    "@@ -10 +9,2 @@",
    "+extra",
    " last",
  ];
  const paired = vm.runInContext("splitDiffRows(diffRows(lines))", h.context);
  assert.equal(paired[0].kind, "@");
  assert.equal(paired[1].left.text, "same");
  assert.equal(paired[1].right.text, "same");
  assert.equal(paired[2].left.text, "old one");
  assert.equal(paired[2].right.text, "new one");
  assert.equal(paired[3].left.text, "old two");
  assert.equal(paired[3].right, null);
  assert.equal(paired[4].left.text, "tail");
  assert.equal(paired[5].kind, "@");
  assert.equal(paired[6].left, null);
  assert.equal(paired[6].right.text, "extra");
  assert.equal(paired[7].right.text, "last");
});
test("sidebar diff layout toggle shares and saves preference without opening a tab or reloading Git", () => {
  const h = harness(),
    saved = {};
  h.context.localStorage.setItem = (k, v) => (saved[k] = v);
  find(h.mod.render(h.cx), "changes-diff-split").handlers.click({}, h.cx);
  assert.equal(h.mod.diffLayout, "split");
  assert.equal(h.values["better-changes.diff-layout"], "split");
  assert.equal(saved["better-changes.diff-layout"], "split");
  assert.equal(h.commands.length, 0);
  assert.equal(h.calls.length, 0);
  find(h.mod.render(h.cx), "changes-diff-inline").handlers.click({}, h.cx);
  assert.equal(h.values["better-changes.diff-layout"], "inline");
});
test("side by side uses paired rows and one virtual list while retaining the same file selection", () => {
  const h = harness("diff");
  h.mod.path = "src/app.js";
  h.mod.rows = [
    { kind: "-", old: 1, text: "before" },
    { kind: "+", next: 1, text: "after" },
  ];
  h.mod.diffLayout = "split";
  const rendered = h.mod.render(h.cx);
  assert.ok(find(rendered, "diff-scroll-left"));
  assert.ok(find(rendered, "diff-scroll-right"));
  assert.equal(find(rendered, "factory-diff-x"), undefined);
  assert.equal(h.mod.pairedRows.length, 1);
  assert.equal(h.mod.path, "src/app.js");
  h.mod.width = 2000;
  h.mod.scrollSplit(100, h.cx);
  assert.equal(h.mod.splitOffset, 100);
  h.mod.scrollSplit(-500, h.cx);
  assert.equal(h.mod.splitOffset, 0);
  h.mod.setDiffLayout("inline", h.cx);
  assert.ok(find(h.mod.render(h.cx), "factory-diff-x"));
  assert.equal(h.mod.path, "src/app.js");
  assert.equal(h.commands.length, 0);
});
test("folder collapse is independent between staged and unstaged groups", () => {
  const h = harness();
  h.mod.files = [{ ...files[0], staged: true, unstaged: true }];
  let rendered = h.mod.render(h.cx);

  find(rendered, "changes-folder-staged-src").handlers.click({}, h.cx);
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "change-staged-src/app.js"), undefined);
  assert.ok(find(rendered, "change-unstaged-src/app.js"));

  find(rendered, "changes-folder-staged-src").handlers.click({}, h.cx);
  assert.ok(find(h.mod.render(h.cx), "change-staged-src/app.js"));
});

test("ordinary layouts open the diff tab without requiring a Factory center stack", () => {
  const h = harness();
  h.context.layout = () => ({ id: "root", children: [{ id: "main", content: { tab: "active" } }] });
  h.mod.pick(files[0], h.cx);
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 1);
  assert.equal(h.commands.filter((c) => c.cmd === "layout.select").length, 0);
});
test("log records, commit file lists and relative times parse Git output", () => {
  const h = harness();
  h.context.log =
    "aaa\0a1\0Ann\0ann@x\x00100\0First\0Body line\n\n\x1e\nbbb\0b2\0Bob\0bob@x\x00200\0Second\0\x1e\n";
  const commits = vm.runInContext("parseLog(log)", h.context);
  assert.equal(commits.length, 2);
  assert.deepEqual(
    { ...commits[0] },
    { hash: "aaa", short: "a1", author: "Ann", email: "ann@x", at: 100, subject: "First", body: "Body line" },
  );
  assert.equal(commits[1].body, "");
  h.context.numstat = "2\t1\tsrc/app.js\0-\t-\timg.png\0";
  h.context.names = "M\0src/app.js\0A\0img.png\0";
  const files = vm.runInContext("commitFiles(numstat, names)", h.context);
  assert.deepEqual({ ...files[0] }, { path: "src/app.js", add: 2, del: 1, binary: false, status: "M" });
  assert.deepEqual({ ...files[1] }, { path: "img.png", add: 0, del: 0, binary: true, status: "A" });
  assert.equal(vm.runInContext("timeAgo(0, 90)", h.context), "1m ago");
  assert.equal(vm.runInContext("timeAgo(0, 3 * 86400)", h.context), "3d ago");
  assert.equal(vm.runInContext("timeAgo(50, 55)", h.context), "just now");
  for (const remote of [
    "https://github.com/munza/herdr-mods.git",
    "git@github.com:munza/herdr-mods.git",
    "ssh://git@github.com/munza/herdr-mods",
  ]) {
    h.context.remote = remote;
    assert.equal(vm.runInContext("githubRepo(remote)", h.context), "munza/herdr-mods");
  }
  h.context.remote = "https://gitlab.com/munza/herdr-mods.git";
  assert.equal(vm.runInContext("githubRepo(remote)", h.context), null);
});
test("commits tab pages history, opens a commit's files, and diffs a file against its first parent", async () => {
  const h = harness();
  const record = (i) => `h${i}\0s${i}\0Ann\0a@x\x00${i}\0Subject ${i}\0\x1e\n`;
  h.context.exec = async (cmd, args, options) => {
    h.calls.push({ cmd, args, options });
    if (args.includes("log")) {
      const n = Number(args[args.indexOf("-n") + 1]);
      const skip = Number(args[args.indexOf("--skip") + 1]);
      const count = skip ? 3 : n;
      return { code: 0, stdout: Array.from({ length: count }, (_, i) => record(skip + i)).join("") };
    }
    if (args.includes("--numstat")) return { code: 0, stdout: "1\t0\tsrc/app.js\0" };
    if (args.includes("--name-status")) return { code: 0, stdout: "M\0src/app.js\0" };
    return { code: 0, stdout: "@@ -1 +1 @@\n-a\n+b\n" };
  };
  let rendered = h.mod.render(h.cx);
  assert.ok(find(rendered, "changes-list"));
  find(rendered, "changes-tab-commits").handlers.click({}, h.cx);
  await h.flush();
  assert.equal(h.mod.commits.length, 50);
  assert.equal(h.mod.commitsDone, false);
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "changes-list"), undefined);
  find(rendered, "commit-more").handlers.click({}, h.cx);
  await h.flush();
  assert.equal(h.mod.commits.length, 53);
  assert.equal(h.mod.commitsDone, true);
  assert.equal(h.calls.at(-1).args[h.calls.at(-1).args.indexOf("--skip") + 1], "50");
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "commit-more"), undefined);
  find(rendered, "commit-h7").handlers.click({}, h.cx);
  await h.flush();
  assert.equal(h.mod.selectedCommit.subject, "Subject 7");
  assert.equal(h.mod.commitFiles.map((f) => f.path).join(), "src/app.js");
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "commit-link").handlers.click, undefined);
  h.mod.repo = "munza/herdr-mods";
  const opened = [];
  rendered = h.mod.render(h.cx);
  const link = find(rendered, "commit-link").handlers.click;
  link({ modifiers: {} }, { ...h.cx, open_url: (u) => opened.push(u) });
  assert.equal(opened.length, 0);
  link({ modifiers: { platform: true } }, { ...h.cx, open_url: (u) => opened.push(u) });
  assert.deepEqual(opened, ["https://github.com/munza/herdr-mods/commit/h7"]);
  const shows = h.calls.filter((c) => c.args.includes("show"));
  assert.equal(shows.length, 2);
  assert.ok(shows.every((c) => c.args.includes("--diff-merges=first-parent") && c.args.includes("h7")));
  rendered = h.mod.render(h.cx);
  assert.equal(find(rendered, "changes-stage-src/app.js"), undefined);
  find(rendered, "change-commit-src/app.js").handlers.click({}, h.cx);
  const selected = h.values["better-changes.selection"];
  assert.equal(selected.scope, "commit");
  assert.equal(selected.commit.hash, "h7");
  assert.equal(selected.file.add, 1);
  assert.equal(h.commands.filter((c) => c.cmd === "tab.new").length, 1);
  find(rendered, "commit-back").handlers.click({}, h.cx);
  assert.equal(h.mod.selectedCommit, null);

  const d = harness("diff");
  d.context.exec = h.context.exec;
  d.values["better-changes.selection"] = selected;
  d.mod.syncSelection(d.cx);
  await d.flush();
  const diff = h.calls.at(-1).args; // the shared exec stub records into h.calls
  assert.ok(diff.includes("show") && diff.includes("h7") && !diff.includes("diff"));
  assert.equal(diff.at(-1), "src/app.js");
  assert.equal(d.mod.rows.length, 3);
  rendered = d.mod.render(d.cx);
  assert.ok(JSON.stringify(rendered).includes("Commit s7 · Subject 7"));
});

test("settings from mod.json set the limits and the view default when nothing is stored", async () => {
  const h = harness();
  h.context.readTextFile = async () => JSON.stringify({ settings: { limits: { files: 2 }, default: { view: "flat" } } });
  h.context.appHome = () => "/app";
  h.mod.applySettings(h.cx);
  await h.flush();
  assert.equal(h.mod.settings.limits.files, 2);
  assert.equal(h.mod.view, "flat");
});

test("opening a commit during a history load leaves neither loading state stuck", async () => {
  const h = harness();
  h.mod.root = "/repo";
  h.mod.loadCommits(h.cx);
  h.mod.openCommit({ hash: "a".repeat(40), short: "aaaaaaa" }, h.cx);
  await h.flush();
  assert.equal(h.mod.commitsLoading, false);
  assert.equal(h.mod.commitFilesLoading, false);
});
