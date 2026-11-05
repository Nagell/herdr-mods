// Real Git in temporary repositories, against the mod's own methods.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const dir = path.join(__dirname, "../mods/better-changes");
const strip = (source) =>
  source
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/^export default (\w+);$/m, "return $1;")
    .replace(/^export /gm, "");
const read = (file) => strip(fs.readFileSync(`${dir}/${file}`, "utf8"));
const MODEL_NAMES =
  "conflictRows, changedFiles, fileTree, diffRows, splitDiffRows, parseLog, commitFiles, timeAgo, githubRepo";
const model = new Function(`${read("git/model.js")}; return { ${MODEL_NAMES} };`)();

function load(cwd, { props, saved, home = "/nonexistent" } = {}) {
  const store = new Map();
  const memory = new Map(saved ? [["diff.selection", JSON.stringify(saved)]] : []);
  const never = () => new Promise(() => {});
  const stub = new Proxy(() => stub, { get: () => stub, apply: () => stub });
  const env = {
    ...model,
    View: class {},
    props: () => props ?? { source: { cwd, on: null } },
    appHome: () => home,
    spaces: () => [],
    panes: () => [],
    focused: () => null,
    theme: () => ({}),
    shared: (key) => store.get(key),
    setShared: (key, value) => store.set(key, value),
    run: () => {},
    nextCommand: never,
    watchFolder: never,
    readTextFile: async (file) => fs.readFileSync(file, "utf8"),
    exec: async (program, args, options) => {
      const r = spawnSync(program, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    localStorage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
  };
  for (const name of [
    "TEXT",
    "SIZE",
    "codeFont",
    "Icon",
    "Chevron",
    "Panel",
    "PanelHeader",
    "PaneBar",
    "HeaderTab",
    "IconButton",
    "TextButton",
    "GroupHeader",
    "Row",
    "DiffStat",
    "StatusLetter",
    "Message",
    "Menu",
    "MenuLabel",
    "MenuDivider",
    "MenuOption",
    "div",
    "v_flex",
    "h_flex",
    "Scrollbar",
    "v_virtual_list",
    "svg",
    "image",
    "home",
    "layout",
    "Textarea",
    "TextBox",
    "SplitButton",
    "SplitTrigger",
  ])
    env[name] = stub;
  env.SPIN_MS = 20;
  env.TextareaState = {
    new: () => ({
      text: "",
      on() {},
      value() {
        return this.text;
      },
      set_value(v) {
        this.text = v;
      },
    }),
  };
  const source = ["settings.js", "git/reads.js", "git/repository.js", "views/sidebar.js", "views/diff.js", "views/pane-header.js", "main.js"]
    .map(read)
    .join("\n");
  const Mod = new Function(...Object.keys(env), source)(...Object.values(env));
  const pending = [];
  const cx = {
    notify() {},
    focus_handle: () => ({}),
    timer: { every() {}, after: (ms, handler) => setTimeout(() => handler(cx), ms) },
    spawn(fn) {
      const p = fn(cx);
      pending.push(p);
      return p;
    },
  };
  const mod = new Mod();
  // Waits for reads, but not for the loops that wait forever on commands and saves.
  cx.settle = async () => {
    for (let idle = 0; idle < 3;) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      idle =
        mod.loading || mod.busy || mod.diffLoading || mod.amendLoading || mod.commitsLoading
          ? 0
          : idle + 1;
    }
  };
  mod.init({}, cx);
  return { mod, cx };
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "better-changes-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(`${root}/a.txt`, "one\n");
  git("add", "a.txt");
  git("commit", "-qm", "first");
  return { root, git };
}

test("refresh spins for a full turn, then stops, and doesn't start twice", async () => {
  const { root } = repo();
  const { mod, cx } = load(root);
  await cx.settle();
  assert.ok(!mod.refreshSpinning);
  mod.refreshAll(cx);
  assert.equal(mod.refreshSpinning, true);
  mod.refreshAll(cx);
  await cx.settle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(mod.refreshSpinning, false);
});

test("stage and unstage move a file between the groups and keep it on disk", async () => {
  const { root } = repo();
  fs.mkdirSync(`${root}/src`);
  fs.writeFileSync(`${root}/src/[new].txt`, "hello\n");
  const { mod, cx } = load(root);
  await cx.settle();
  assert.deepEqual(
    mod.files.filter((f) => f.unstaged).map((f) => f.path),
    ["src/[new].txt"],
  );

  mod.indexAction("stage", "src/[new].txt", cx);
  await cx.settle();
  assert.deepEqual(
    mod.files.filter((f) => f.staged).map((f) => f.path),
    ["src/[new].txt"],
  );
  assert.deepEqual(
    mod.files.filter((f) => f.unstaged),
    [],
  );

  mod.indexAction("unstage", "src/[new].txt", cx);
  await cx.settle();
  assert.deepEqual(
    mod.files.filter((f) => f.staged),
    [],
  );
  assert.equal(fs.readFileSync(`${root}/src/[new].txt`, "utf8"), "hello\n");
});

test("stage all and unstage all move every file and keep them on disk", async () => {
  const { root } = repo();
  fs.writeFileSync(`${root}/a.txt`, "changed\n");
  fs.writeFileSync(`${root}/new.txt`, "new\n");
  const { mod, cx } = load(root);
  await cx.settle();

  mod.indexAction("stage", null, cx);
  await cx.settle();
  assert.deepEqual(
    mod.files.filter((f) => f.staged).map((f) => f.path),
    ["a.txt", "new.txt"],
  );
  assert.deepEqual(
    mod.files.filter((f) => f.unstaged),
    [],
  );

  mod.indexAction("unstage", null, cx);
  await cx.settle();
  assert.deepEqual(
    mod.files.filter((f) => f.staged),
    [],
  );
  assert.deepEqual(
    mod.files.filter((f) => f.unstaged).map((f) => f.path),
    ["a.txt", "new.txt"],
  );
  assert.equal(fs.readFileSync(`${root}/a.txt`, "utf8"), "changed\n");
  assert.equal(fs.readFileSync(`${root}/new.txt`, "utf8"), "new\n");
});

test("committed lists unpushed files and commits, and clears on push", async () => {
  const { root, git } = repo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "better-changes-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  git("push", "-qu", "origin", "main");
  fs.writeFileSync(`${root}/b.txt`, "two\n");
  git("add", "b.txt");
  git("commit", "-qm", "second");

  const { mod, cx } = load(root);
  await cx.settle();
  assert.deepEqual(
    mod.committed.files.map((f) => f.path),
    ["b.txt"],
  );
  assert.equal(mod.committed.unpushed.size, 1);

  git("push", "-q");
  mod.refresh(cx);
  await cx.settle();
  assert.equal(mod.committed.total, 0);
  assert.equal(mod.committed.unpushed.size, 0);
});

test("the tree nests under folders and a closed folder hides its files", () => {
  const files = ["src/ui/a.js", "src/b.js", "c.js"].map((p) => ({ path: p }));
  const rows = model.fileTree(files);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.depth]),
    [
      ["folder", 0],
      ["folder", 1],
      ["file", 2],
      ["file", 1],
      ["file", 0],
    ],
  );
  assert.equal(model.fileTree(files, new Set(["src"])).length, 2);
});

test("a commit link needs a GitHub origin", () => {
  assert.equal(model.githubRepo("git@github.com:owner/repo.git\n"), "owner/repo");
  assert.equal(model.githubRepo("https://github.com/owner/repo"), "owner/repo");
  assert.equal(model.githubRepo("git@gitlab.com:owner/repo.git"), null);
});

test("a pane header reads no Git, since one copy runs per pane", async () => {
  const { root } = repo();
  const { mod, cx } = load(root, { props: { pane: "p1", terminal: "t1" } });
  await cx.settle();
  assert.equal(mod.mode, "pane-header");
  assert.equal(mod.root, undefined);
});

function conflicted() {
  const { root, git } = repo();
  fs.writeFileSync(`${root}/gone.txt`, "keep\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  fs.writeFileSync(`${root}/a.txt`, "feature\n");
  fs.writeFileSync(`${root}/gone.txt`, "changed\n");
  git("add", ".");
  git("commit", "-qm", "feature");
  git("checkout", "-q", "main");
  fs.writeFileSync(`${root}/a.txt`, "main\n");
  git("rm", "-q", "gone.txt");
  git("add", ".");
  git("commit", "-qm", "main");
  spawnSync("git", ["merge", "feature"], { cwd: root });
  return root;
}

async function openDiff(root, file) {
  const source = { cwd: root, on: null };
  const selection = {
    context: JSON.stringify(source),
    root,
    on: null,
    path: file,
    scope: "conflict",
    at: 1,
  };
  const { mod, cx } = load(root, { props: { mode: "diff", space: "s", source, selection } });
  await cx.settle();
  return mod;
}

test("stage all and unstage all leave conflicts alone", async () => {
  const root = conflicted();
  fs.writeFileSync(`${root}/clean.txt`, "new\n");
  const { mod, cx } = load(root);
  await cx.settle();
  const status = () =>
    execFileSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" });
  const conflictsBefore = status()
    .split("\n")
    .filter((line) => /^(UU|DU|UD|AA)/.test(line));
  assert.equal(conflictsBefore.length, 2);

  mod.indexAction("stage", null, cx);
  await cx.settle();
  assert.match(status(), /^A {2}clean\.txt$/m);
  assert.deepEqual(
    status()
      .split("\n")
      .filter((line) => /^(UU|DU|UD|AA)/.test(line)),
    conflictsBefore,
  );
  assert.equal(mod.canCommit(), false);

  mod.indexAction("unstage", null, cx);
  await cx.settle();
  assert.match(status(), /^\?\? clean\.txt$/m);
  assert.deepEqual(
    status()
      .split("\n")
      .filter((line) => /^(UU|DU|UD|AA)/.test(line)),
    conflictsBefore,
  );
});

test("two nearby conflicts show the lines between them once", () => {
  const block = (name) => [
    `<<<<<<< HEAD`,
    `${name} mine`,
    "=======",
    `${name} theirs`,
    ">>>>>>> topic",
  ];
  const file = [...block("a"), "between 1", "between 2", ...block("b")].join("\n");
  const { inline } = model.conflictRows(file);
  assert.equal(inline.filter((row) => row.text === "between 1").length, 1);
  assert.equal(inline.filter((row) => row.text === "between 2").length, 1);
});

test("a conflict says what kind it is", async () => {
  const root = conflicted();
  const { mod, cx } = load(root);
  await cx.settle();
  const kinds = Object.fromEntries(
    mod.files.filter((f) => f.conflict).map((f) => [f.path, f.conflictKind]),
  );
  assert.deepEqual(kinds, { "a.txt": "both edited", "gone.txt": "deleted by you" });
});

test("a conflict shows the file's markers, and says how many", async () => {
  const mod = await openDiff(conflicted(), "a.txt");
  const texts = mod.rows.map((row) => row.text);
  assert.ok(texts.some((text) => text.startsWith("<<<<<<< ")));
  assert.ok(texts.includes("======="));
  assert.ok(texts.some((text) => text.startsWith(">>>>>>> ")));
  assert.ok(mod.rows.some((row) => row.kind === "yours" && row.text === "main"));
  assert.ok(mod.rows.some((row) => row.kind === "incoming" && row.text === "feature"));
  assert.match(mod.head().detail, /1 conflict/);
  const pair = mod.pairedRows.find((row) => row.left?.kind === "yours");
  assert.equal(pair.left.text, "main");
  assert.equal(pair.right.text, "feature");
});

test("conflict rows keep file line numbers, a few lines around, and the base inline", () => {
  const file = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "<<<<<<< HEAD",
    "mine",
    "more mine",
    "||||||| base",
    "old",
    "=======",
    "theirs",
    ">>>>>>> topic",
    "after",
    "6",
    "7",
    "8",
    "9",
  ].join("\n");
  const { inline, split, count } = model.conflictRows(file);
  assert.equal(count, 1);
  assert.equal(inline[0].text, "Conflict 1 of 1 · line 6");
  assert.deepEqual(
    inline.slice(1, 4).map((r) => r.text),
    ["3", "4", "5"],
  );
  assert.equal(inline.find((r) => r.text === "theirs").next, 12);
  assert.ok(inline.some((r) => r.kind === "base" && r.text === "old"));
  assert.ok(!inline.some((r) => r.text === "1"));
  assert.ok(!split.some((r) => r.left?.text === "old" || r.right?.text === "old"));
  const pairs = split.filter((r) => r.left?.kind === "yours");
  assert.deepEqual(
    pairs.map((r) => [r.left.text, r.right?.text ?? null]),
    [
      ["mine", "theirs"],
      ["more mine", null],
    ],
  );
});

test("a file without a complete conflict block has no conflict rows", () => {
  assert.equal(model.conflictRows("plain\n======="), null);
  assert.equal(model.conflictRows("<<<<<<< HEAD\nnever closed\n"), null);
});

test("a conflict with one side deleted says so", async () => {
  const mod = await openDiff(conflicted(), "gone.txt");
  assert.match(mod.rows[0].text, /deleted on your side/);
});

const write = (mod, text) => {
  mod.message = text;
  mod.input.set_value(text);
};
const log = (git) => git("log", "--format=%s").trim().split("\n");

test("commit takes only what is staged and clears the draft", async () => {
  const { root, git } = repo();
  fs.writeFileSync(`${root}/a.txt`, "staged\n");
  fs.writeFileSync(`${root}/b.txt`, "not staged\n");
  git("add", "a.txt");
  const { mod, cx } = load(root);
  await cx.settle();
  assert.equal(mod.canCommit(), false);
  write(mod, "  second  ");
  assert.equal(mod.canCommit(), true);
  mod.commit(cx);
  await cx.settle();
  assert.deepEqual(log(git), ["second", "first"]);
  assert.equal(mod.message, "");
  assert.deepEqual(
    mod.files.map((f) => f.path),
    ["b.txt"],
  );
});

test("amend loads the message, can change only the message, and keeps a draft", async () => {
  const { root, git } = repo();
  const { mod, cx } = load(root);
  await cx.settle();
  mod.setCommitMode("amend", cx);
  await cx.settle();
  assert.equal(mod.message, "first");
  write(mod, "renamed");
  mod.commit(cx);
  await cx.settle();
  assert.deepEqual(log(git), ["renamed"]);
  assert.equal(mod.commitMode, "commit");

  write(mod, "my draft");
  mod.setCommitMode("amend", cx);
  await cx.settle();
  assert.equal(mod.message, "my draft");
  mod.setCommitMode("commit", cx);
  assert.equal(mod.message, "my draft");
  write(mod, "");
  mod.setCommitMode("amend", cx);
  await cx.settle();
  assert.equal(mod.message, "renamed");
  mod.setCommitMode("commit", cx);
  assert.equal(mod.message, "");
});

test("amend refuses when HEAD moved, and keeps the draft", async () => {
  const { root, git } = repo();
  const { mod, cx } = load(root);
  await cx.settle();
  mod.setCommitMode("amend", cx);
  await cx.settle();
  write(mod, "rewrite");
  git("commit", "-q", "--allow-empty", "-m", "someone else");
  mod.commit(cx);
  await cx.settle();
  assert.deepEqual(log(git), ["someone else", "first"]);
  assert.match(mod.note, /latest commit changed/);
  assert.equal(mod.message, "rewrite");
});

test("history knows not pulled counts and the default branch", async () => {
  const { root, git } = repo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "better-changes-remote-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  git("remote", "add", "origin", remote);
  git("push", "-qu", "origin", "main");
  git("remote", "set-head", "origin", "main");
  git("checkout", "-qb", "topic");
  git("commit", "-q", "--allow-empty", "-m", "topic pushed");
  git("push", "-qu", "origin", "topic");
  git("commit", "-q", "--allow-empty", "-m", "topic local");
  git("checkout", "-q", "main");
  git("commit", "-q", "--allow-empty", "-m", "main moved");
  git("push", "-q");
  git("checkout", "-q", "topic");

  const { mod, cx } = load(root);
  await cx.settle();
  mod.setTab("commit", cx);
  await cx.settle();
  assert.equal(mod.branch, "topic");
  assert.equal(mod.committed.name, "origin/topic");
  assert.equal(mod.committed.unpushed.size, 1);
  assert.equal(mod.remoteHead.target, "origin/main");
  assert.equal(mod.remoteHead.behind, 1);
  assert.equal(mod.remoteHead.ahead.size, 2);
  assert.equal(mod.behind, 0);
});

test("a reopened diff shows the file it last showed, with a line count for a new file", async () => {
  const { root } = repo();
  fs.writeFileSync(`${root}/old.txt`, "x\n");
  fs.writeFileSync(`${root}/new.txt`, "one\ntwo\nthree\n");
  const source = { cwd: root, on: null };
  const context = JSON.stringify(source);
  const selection = { context, root, on: null, path: "old.txt", scope: "unstaged", at: 1 };
  const saved = { ...selection, path: "new.txt", at: 2 };
  const { mod, cx } = load(root, { props: { mode: "diff", space: "s", source, selection }, saved });
  await cx.settle();
  assert.equal(mod.path, "new.txt");
  assert.equal(mod.head().title, "new.txt");
  assert.equal(mod.head().add, 3);
});

test("settings come from mod.json and a limit of zero falls back", async () => {
  const { root } = repo();
  fs.writeFileSync(`${root}/one.txt`, "1\n");
  fs.writeFileSync(`${root}/two.txt`, "2\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "better-changes-home-"));
  fs.mkdirSync(`${home}/mods/better-changes`, { recursive: true });
  fs.writeFileSync(
    `${home}/mods/better-changes/mod.json`,
    JSON.stringify({
      settings: { limits: { files: 1, diff_lines: 0 }, default: { view: "flat" } },
    }),
  );
  const { mod, cx } = load(root, { home });
  await cx.settle();
  mod.refresh(cx);
  await cx.settle();
  assert.equal(mod.view, "flat");
  assert.equal(mod.total, 2);
  assert.equal(mod.files.length, 1);
  assert.equal(mod.settings.limits.diff_lines, 1500);
});
