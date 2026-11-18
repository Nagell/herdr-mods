const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

// Inspect fluent GPUI descriptions without opening a window. Timers do not run
// automatically; flush() waits for spawned reads, making races deterministic.
function harness(stored = {}) {
  const live = { spaces: [], panes: [], machines: [] };
  const pending = [],
    scrolled = [],
    calls = [],
    commands = [],
    overlays = [],
    values = {};
  const colors = {
    foreground: "white",
    dim: "gray",
    ansi1: "red",
    ansi2: "green",
    ansi3: "yellow",
    ansi5: "purple",
  };
  function element() {
    const node = { nodes: [], handlers: {}, attributes: {} };
    let proxy;
    proxy = new Proxy(node, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "child" || key === "trigger" || key === "content")
          return (child) => {
            target.nodes.push(child);
            return proxy;
          };
        if (key === "children")
          return (children) => {
            target.nodes.push(...children);
            return proxy;
          };
        if (key === "when")
          return (condition, build) => {
            if (condition) build(proxy);
            return proxy;
          };
        return (...args) => {
          if (key === "id") target.id = args[0];
          if (key.startsWith("on_")) target.handlers[key.slice(3)] = args.at(-1);
          if (key === "on_mouse_down" || key === "on_mouse_up") {
            target.handlers[`${key.slice(3)}_${args[0]}`] = args.at(-1);
          }
          target.attributes[key] = args;
          return proxy;
        };
      },
    });
    return proxy;
  }
  const cx = {
    notify() {},
    stop_propagation() {},
    focus_handle: () => ({ focus() {} }),
    timer: { every() {} },
    spawn(fn) {
      pending.push(fn(cx));
    },
  };
  const context = {
    View: class {},
    div: element,
    svg: (p) => {
      const e = element();
      e.svgPath = p;
      return e;
    },
    h_flex: element,
    v_flex: element,
    spaces: () => live.spaces,
    panes: () => live.panes,
    machines: () => live.machines,
    theme: () => colors,
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true }),
    props: () => ({}),
    Popover: { new: (id) => element().id(id) },
    ScrollHandle: { new: () => ({ scroll_to_item: (index) => scrolled.push(index) }) },
    shared: (key) => values[key],
    setShared: (key, value) => {
      values[key] = value;
    },
    run: (name, args) => commands.push({ name, args }),
    openOverlay: (args) => overlays.push(args),
    localStorage: {
      getItem: (key) => stored[key] ?? null,
      setItem(key, value) {
        stored[key] = String(value);
      },
    },
    hc: async () => ({ code: 0, stdout: '{"machines":[]}' }),
    watchFolder: async () => {
      throw Error("No watcher in tests");
    },
    exec: async (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return { code: 0, stdout: "" };
    },
  };
  vm.createContext(context);
  for (const file of [
    "settings.js",
    "git/pr-status.js",
    "git/checkouts.js",
    "views/find-node.js",
    "views/ui.js",
    "views/spaces.js",
  ]) {
    const source = fs
      .readFileSync(path.join(runtime, file), "utf8")
      .replace(/^import\s+[\s\S]*?;\n/gm, "")
      .replace("export class Spaces", "globalThis.Spaces = class Spaces")
      .replaceAll("export ", "");
    vm.runInContext(source, context);
  }
  const mod = new context.Spaces();
  mod.init({}, cx);
  return {
    live,
    scrolled,
    stored,
    calls,
    commands,
    overlays,
    values,
    colors,
    context,
    cx,
    mod,
    observer: mod.prObserver,
    flush: async () => {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.nodes ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
}
function text(node) {
  if (typeof node === "string") return node;
  return (node?.nodes ?? []).map(text).join(" ");
}
const result = (stdout) => ({ code: 0, stdout });

test("PR appearance distinguishes open, draft, merged, closed, failed checks, conflicts, review and ready", () => {
  const h = harness();
  h.context.colors = h.colors;
  for (const [pr, icon, color, label, ready] of [
    [{ state: "OPEN" }, "pull-request", "green"],
    [{ state: "OPEN", isDraft: true }, "draft", "gray"],
    [{ state: "MERGED", isDraft: true }, "merged", "purple"],
    [{ state: "CLOSED" }, "closed", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ conclusion: "FAILURE" }] }, "pull-request", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ state: "ERROR" }] }, "pull-request", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ status: "IN_PROGRESS" }] }, "pull-request", "green", "Open"],
    [{ state: "OPEN", mergeStateStatus: "DIRTY", statusCheckRollup: [{ conclusion: "FAILURE" }] }, "pull-request", "red", "Conflicts"],
    [{ state: "OPEN", isDraft: true, mergeStateStatus: "DIRTY" }, "draft", "gray", "Draft"],
    [{ state: "OPEN", reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [{ conclusion: "FAILURE" }] }, "pull-request", "red", "Checks failed"],
    [{ state: "OPEN", reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "CLEAN" }, "pull-request", "yellow", "Changes requested"],
    [{ state: "OPEN", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN" }, "pull-request", "green", "Ready to merge", true],
    [{ state: "OPEN", reviewDecision: "", mergeStateStatus: "CLEAN" }, "pull-request", "green", "Ready to merge", true],
    [{ state: "OPEN", reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" }, "pull-request", "green", "Open"],
    [{ state: "OPEN", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }, "pull-request", "green", "Open"],
  ]) {
    h.context.pr = pr;
    const appearance = vm.runInContext("prAppearance(pr, colors)", h.context);
    assert.equal(appearance.icon, icon);
    assert.equal(appearance.color, color);
    if (label) assert.equal(appearance.label, label);
    assert.equal(Boolean(appearance.ready), Boolean(ready));
  }
});

test("GitHub remote parsing supports HTTPS/SSH but rejects other hosts", () => {
  const h = harness();
  for (const url of [
    "https://github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo.git",
  ]) {
    h.context.url = url;
    assert.equal(vm.runInContext("githubRepository(url)", h.context), "owner/repo");
  }
  h.context.url = "https://example.com/owner/repo";
  assert.equal(vm.runInContext("githubRepository(url)", h.context), undefined);
});

test("explicit branch association reads Git remotely and invokes gh locally", async () => {
  const h = harness();
  h.context.exec = async (cmd, args, options) => {
    h.calls.push({ cmd, args, options });
    if (cmd === "git")
      return args.includes("symbolic-ref") ? result("custom-name\n") : result("owner/repo#42\n");
    assert.equal(cmd, "gh");
    assert.equal(args[1], "view");
    assert.equal(args[2], "42");
    assert.equal(args[args.indexOf("--repo") + 1], "owner/repo");
    assert.match(args[args.indexOf("--json") + 1], /reviewDecision,mergeStateStatus/);
    assert.equal(options, undefined);
    return result(JSON.stringify({ number: 42, state: "OPEN" }));
  };
  const prs = await h.observer.lookup({ folder: "/checkout", machine: "remote" });
  assert.equal(prs[0].repository, "owner/repo");
  assert.ok(
    h.calls
      .filter((call) => call.cmd === "git")
      .every((call) => call.options.on === "remote" && call.options.cwd === "/checkout"),
  );
});

test("discovery excludes unrelated forks, deduplicates PRs, and prefers open over merged", async () => {
  const h = harness();
  h.context.exec = async (_cmd, args) => {
    if (args.includes("symbolic-ref")) return result("feature");
    if (args.includes("config")) return { code: 1, stdout: "" };
    if (args.includes("get-url")) return result("git@github.com:owner/repo.git");
    return result("origin\nupstream\n");
  };
  const pr = (id, state, owner = "owner/repo") => ({
    id,
    number: Number(id),
    state,
    headRefName: "feature",
    headRepository: { nameWithOwner: owner },
  });
  h.observer.query = async (args) => {
    assert.equal(args[1], "list");
    assert.equal(args[args.indexOf("--head") + 1], "feature");
    assert.match(args[args.indexOf("--json") + 1], /reviewDecision,mergeStateStatus/);
    return [pr("1", "MERGED"), pr("2", "OPEN"), pr("2", "OPEN"), pr("3", "OPEN", "stranger/fork")];
  };
  const prs = await h.observer.lookup({ folder: "/repo" });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 2);
});

test("polling deduplicates paths, throttles, and hides stale PRs on branch changes", async () => {
  const h = harness(),
    place = { folder: "/repo", machine: null, branch: "main" };
  let reads = 0;
  h.observer.lookup = async () => {
    reads++;
    return [{ number: 1 }];
  };
  h.observer.refresh([place, place], h.cx);
  await h.flush();
  h.observer.refresh([place], h.cx);
  await h.flush();
  assert.equal(reads, 1);
  h.observer.lookup = async () => {
    reads++;
    throw Error("offline");
  };
  // Expire the read, then retain last-good status for this same branch.
  h.observer.checked.get('[null,"/repo"]').at = 0;
  h.observer.refresh([place], h.cx);
  await h.flush();
  assert.equal(h.observer.entries.get('[null,"/repo"]').prs[0].number, 1);
  h.observer.refresh([{ ...place, branch: "feature" }], h.cx);
  await h.flush();
  assert.equal(h.observer.entries.get('[null,"/repo"]').prs.length, 0);
  assert.match(h.observer.entries.get('[null,"/repo"]').error, /offline/);
  h.observer.refresh([], h.cx);
  await h.flush();
  assert.equal(h.observer.entries.size, 0);
});

test("late PR results cannot publish after switching branch or removing the checkout", async () => {
  const h = harness(),
    place = { folder: "/repo", branch: "main" };
  let resolve;
  h.observer.lookup = () =>
    new Promise((done) => {
      resolve = done;
    });
  h.observer.refresh([place], h.cx);
  h.observer.refresh([{ ...place, branch: "feature" }], h.cx);
  resolve([{ number: 1 }]);
  await h.flush();
  assert.equal(h.observer.entries.size, 0);
  h.observer.refresh([{ ...place, branch: "feature" }], h.cx);
  h.observer.refresh([], h.cx);
  resolve([{ number: 2 }]);
  await h.flush();
  assert.equal(h.observer.entries.size, 0);
});

test("gh results are cached and failures are not cached", async () => {
  const h = harness();
  h.context.exec = async () => {
    h.calls.push(1);
    return result("[]");
  };
  await h.observer.query(["pr", "list"]);
  await h.observer.query(["pr", "list"]);
  assert.equal(h.calls.length, 1);
  h.context.exec = async () => ({ code: 1, stderr: "gh auth login" });
  await assert.rejects(h.observer.query(["pr", "view", "1"]), /gh auth login/);
});

test("the gh cache expires one poll after the call started, not after it returned", async () => {
  const h = harness();
  let now = 0;
  vm.runInContext("Date", h.context).now = () => now;
  h.context.exec = async () => {
    h.calls.push(1);
    now += 1500; // a slow gh call
    return result("[]");
  };
  await h.observer.query(["pr", "list"]);
  now = vm.runInContext("PR_POLL_MS", h.context);
  await h.observer.query(["pr", "list"]);
  assert.equal(h.calls.length, 2);
});

test("non-Git and detached checkouts do not query GitHub", async () => {
  const h = harness();
  for (const output of [
    { code: 1, stdout: "" },
    { code: 128, stderr: "not a git repository" },
  ]) {
    h.context.exec = async (cmd) => {
      assert.equal(cmd, "git");
      return output;
    };
    assert.equal((await h.observer.lookup({ folder: "/tmp" })).length, 0);
  }
});

test("worktree spaces nest under the matching main checkout, with machines isolated", () => {
  const h = harness();
  h.live.spaces = [
    { id: "child", name: "feature", folder: "/tree", tabs: [] },
    { id: "main", name: "repo", folder: "/repo", tabs: [] },
    { id: "remote", name: "remote", folder: "/tree", machine: "server", tabs: [] },
  ];
  for (const s of h.live.spaces) h.mod.shown.add(s.id);
  h.mod.git['[null,"/repo"]'] = { repo: '[null,"/repo/.git"]', linked: false, branch: "main" };
  h.mod.git['[null,"/tree"]'] = { repo: '[null,"/repo/.git"]', linked: true, branch: "feature" };
  h.mod.git['["server","/tree"]'] = {
    repo: '["server","/repo/.git"]',
    linked: true,
    branch: "remote",
  };
  const rows = h.mod.ordered();
  assert.deepEqual(
    Array.from(rows, (row) => row.w.id),
    ["main", "child", "remote"],
  );
  assert.ok(rows[1].tree);
  assert.equal(rows[2].tree, null);
});

test("a row shows an unusual branch, and ahead/behind only when selected", () => {
  const h = harness();
  const g = { branch: "topic", ahead: 2, behind: 1 };
  assert.equal(text(h.mod.branchName(g, "repo", h.colors)).trim(), "topic");
  assert.match(text(h.mod.gitTail(g, true, h.colors)), /\u21912.*\u21931/);
  assert.equal(text(h.mod.gitTail(g, false, h.colors)).trim(), "");
  assert.equal(text(h.mod.branchName({ branch: "master" }, "repo", h.colors)).trim(), "");
  assert.equal(text(h.mod.branchName({ branch: "topic" }, "topic", h.colors)).trim(), "");
});

test("space rows put the branch beside the name and their own PR at the right", () => {
  const h = harness();
  const space = { id: "main", name: "repo", folder: "/repo", tabs: [{ id: "tab", active: true }] };
  h.live.spaces = [space];
  h.live.panes = [{ tab: "tab", cwd: "/repo", branch: "main" }];
  h.live.panes[0].branch = "topic";
  const g = { branch: "topic", name: "repo" };
  h.mod.git['[null,"/repo"]'] = g;
  h.observer.entries.set('[null,"/repo"]', {
    branch: "topic",
    prs: [{ number: 42, repository: "owner/repo", title: "Fix", state: "OPEN" }],
  });
  const row = h.mod.row({ w: space, i: 0, g, tree: null }, h.colors);
  assert.match(text(row), /repo.*topic.*#42/);
  assert.doesNotMatch(text(row), /Open/);
  assert.equal(find(row, "space-pr-line-main"), undefined);
  row.handlers.mouse_down_left();
  row.handlers.mouse_up_left({}, h.cx);
  assert.equal(h.commands[0].name, "space.select");
  h.mod.menu(space);
  assert.equal(h.overlays[0].props.target.id, "main");
  h.live.panes[0].branch = "other";
  assert.equal(h.mod.checkoutPRs(space).length, 0);
});

test("PR numbers open their URL only on a modified click without selecting the space", () => {
  const h = harness();
  h.context.window = () => ({ active: true, platform: "macos" });
  const pr = {
    number: 42,
    repository: "owner/repo",
    title: "Example",
    state: "OPEN",
    url: "https://github.com/owner/repo/pull/42",
  };
  h.mod.checkoutPRs = () => [pr];
  const number = find(h.mod.prBadge({ id: "s" }, h.colors), "space-pr-link-s-owner/repo-42");
  const opened = [];
  let stopped = 0;
  h.cx.open_url = (url) => opened.push(url);
  h.cx.stop_propagation = () => stopped++;

  const plain = { modifiers: { platform: false, control: false } };
  number.handlers.mouse_down_left(plain, h.cx);
  number.handlers.mouse_up_left(plain, h.cx);
  number.handlers.click(plain, h.cx);
  assert.equal(opened.length, 0);
  assert.equal(stopped, 0);

  const cmd = { modifiers: { platform: true } };
  h.mod.pressed = 1;
  number.handlers.mouse_down_left(cmd, h.cx);
  number.handlers.mouse_up_left(cmd, h.cx);
  number.handlers.click(cmd, h.cx);
  assert.deepEqual(opened, [pr.url]);
  assert.equal(stopped, 3);
  assert.equal(h.mod.pressed, null);
  assert.equal(h.commands.length, 0);

  h.context.window = () => ({ active: true, platform: "linux" });
  number.handlers.click({ modifiers: { control: true } }, h.cx);
  assert.equal(opened.length, 2);
});

test("draft PRs show only their number, keeping draft color, icon, and tooltip", () => {
  const h = harness();
  const pr = {
    number: 43,
    repository: "owner/repo",
    title: "In progress",
    state: "OPEN",
    isDraft: true,
  };
  h.mod.checkoutPRs = () => [pr];
  const badge = h.mod.prBadge({ id: "s" }, h.colors);
  assert.equal(text(badge).trim(), "#43");
  const row = find(badge, "space-pr-s-owner/repo-43");
  assert.equal(row.attributes.text_color[0], h.colors.dim);
  assert.match(row.attributes.tooltip[0], /Draft/);
  const number = find(badge, "space-pr-link-s-owner/repo-43");
  const opened = [];
  h.cx.open_url = (url) => opened.push(url);
  number.handlers.click({ modifiers: { platform: true } }, h.cx);
  assert.deepEqual(opened, ["https://github.com/owner/repo/pull/43"]);
});

test("render is read-only and compact mode works without a named sidebar block", () => {
  const h = harness();
  h.live.spaces = [{ id: "s", name: "repo", folder: "/repo", tabs: [] }];
  h.mod.shown.add("s");
  h.mod.width = 44;
  const root = h.mod.render();
  assert.ok(find(root, "space-s"));
  assert.equal(text(root).includes("repo"), false);
  assert.deepEqual(h.values, {});
});

test("Git metadata reads preserve remote context and parse ahead/behind", async () => {
  const h = harness();
  h.context.exec = async (cmd, args, options) => {
    h.calls.push({ cmd, args, options });
    if (args.includes("status")) return result("# branch.head feature\n# branch.ab +2 -1\n");
    if (args.includes("--show-toplevel")) return result("/tree\n");
    return result("/repo/.git\n");
  };
  await h.mod.check('["remote","/tree"]', h.cx);
  const g = h.mod.git['["remote","/tree"]'];
  assert.equal(g.branch, "feature");
  assert.equal(g.ahead, 2);
  assert.equal(g.behind, 1);
  assert.equal(g.linked, true);
  assert.ok(h.calls.every((call) => call.options.on === "remote" && call.options.cwd === "/tree"));
});

test("real Git metadata groups a worktree beneath its main checkout", async () => {
  const os = require("node:os");
  const cp = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-spaces-"));
  const main = path.join(directory, "main");
  const tree = path.join(directory, "feature");
  fs.mkdirSync(main);
  const git = (args, cwd = main) =>
    cp.execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  try {
    git(["init", "-q", "-b", "main"]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "baseline",
    ]);
    git(["worktree", "add", "-q", "-b", "feature", tree]);
    const h = harness();
    h.context.exec = async (_cmd, args, options) => result(git(args, options.cwd));
    h.live.spaces = [
      { id: "tree", name: "feature", folder: tree, tabs: [] },
      { id: "main", name: "main", folder: main, tabs: [] },
    ];
    for (const space of h.live.spaces) {
      h.mod.shown.add(space.id);
      await h.mod.check(JSON.stringify([null, space.folder]), h.cx);
    }
    await h.flush();
    const rows = h.mod.ordered();
    assert.deepEqual(
      Array.from(rows, (row) => row.w.id),
      ["main", "tree"],
    );
    assert.equal(rows[0].g.branch, "main");
    assert.equal(rows[1].g.branch, "feature");
    assert.equal(rows[0].g.repo, rows[1].g.repo);
    assert.ok(rows[1].tree);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("package is standalone with local icons and no layout or helper dependency", () => {
  const source = [
    "main.js",
    "views/spaces.js",
    "views/agents.js",
    "views/footer.js",
    "views/panel-toggle.js",
    "views/ui.js",
  ]
    .map((file) => fs.readFileSync(path.join(runtime, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    source,
    /mods\/(?:pull-requests|workspace-chrome|factory-spaces)|herdr-pr/,
  );
  // The one look outside its folder: whether Better Config is installed, to show its button.
  assert.deepEqual(source.match(/appHome\(\)[^`]*/g), ["appHome()}/mods/better-config/mod.json"]);
  const imports = [...source.replace("appHome()}/mods/better-config/mod.json", "").matchAll(/mods\/([^/]+)\//g)];
  assert.ok(imports.every((match) => match[1] === "better-sidebar"));
  for (const icon of [
    "branch",
    "server",
    "monitor",
    "chevron-down",
    "chevron-right",
    "plus",
    "panel-right",
    "clock",
    "layers",
    "git-branch",
    "tag",
    "check",
    "spinner",
    "pin",
    "pin-off",
    "settings",
    "sliders",
    "pull-request",
    "draft",
    "merged",
    "closed",
    "grip-vertical",
    "arrow-down-a-z",
  ]) {
    assert.ok(fs.existsSync(path.join(runtime, `icons/${icon}.svg`)), icon);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, "mod.json"))).place, "none");
  assert.equal(fs.existsSync(path.join(__dirname, "../layouts")), false);
});

test("pull request status can be turned off in the settings", async () => {
  const h = harness();
  h.context.readTextFile = async () => JSON.stringify({ settings: { pull_request_status: false } });
  h.context.appHome = () => "/app";
  h.mod.applySettings(h.cx);
  await h.flush();
  const calls = [];
  h.mod.prObserver.refresh = (...args) => calls.push(args);
  h.mod.checkNew(h.cx);
  await h.flush();
  assert.equal(h.mod.settings.pull_request_status, false);
  assert.equal(calls.length, 0);
});

test("spaces publish each space's main space for the agents block", () => {
  const h = harness();
  const repo = JSON.stringify([null, "/code/shop/.git"]);
  const other = JSON.stringify([null, "/code/lonely/.git"]);
  h.live.spaces = [
    { id: "main", name: "shop", folder: "/code/shop", tabs: [] },
    { id: "wt", name: "PR-6", folder: "/wt/pr-6", tabs: [] },
    { id: "orphan", name: "PR-9", folder: "/wt/pr-9", tabs: [] },
    { id: "plain", name: "notes", folder: "/notes", tabs: [] },
  ];
  const key = (folder) => JSON.stringify([null, folder]);
  h.mod.git = Object.create(null);
  h.mod.git[key("/code/shop")] = { repo, linked: false };
  h.mod.git[key("/wt/pr-6")] = { repo, linked: true };
  h.mod.git[key("/wt/pr-9")] = { repo: other, linked: true };
  h.mod.publishParents(h.live.spaces, []);
  const parents = h.values["better-sidebar.space-parents"];
  assert.equal(parents.main.label, "shop");
  assert.equal(parents.wt.label, "shop", "a worktree goes under its main space");
  assert.equal(parents.wt.key, parents.main.key);
  assert.equal(
    parents.orphan.label,
    "lonely",
    "without an open main space, the repository's folder",
  );
  assert.equal(parents.plain, undefined, "not a repository");
});

// Keyboard space switching: the list scrolls the shown space's row into view, once per change.
function scrolling() {
  const h = harness();
  h.live.spaces = ["trails", "maps", "api", "notes"].map((id) => ({ id, name: id, folder: `/${id}`, tabs: [], active: id === "trails" }));
  for (const sp of h.live.spaces) h.mod.shown.add(sp.id);
  const show = (id) => h.live.spaces.forEach((sp) => (sp.active = sp.id === id));
  return { h, show };
}

test("the list scrolls to the shown space when it changes, and only then", () => {
  const { h, show } = scrolling();
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [0]);
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [0], "no new space, no scroll");
  show("api");
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [0, 2]);
  assert.equal(find(h.mod.body(h.colors, false), "spaces-list").attributes.track_scroll.length, 1);
});

test("it scrolls to the space's group, its row and the rows under it, counting the rows above", () => {
  const { h, show } = scrolling();
  // As in the lists view: pinned agents on top, and each space's tabs under it.
  h.mod.above = () => ["pinned agent"];
  h.mod.under = ({ w }) => [`${w.id} tab 1`, `${w.id} tab 2`];
  show("api");
  const list = find(h.mod.body(h.colors, false), "spaces-list");
  assert.deepEqual(h.scrolled, [3], "1 pinned + the trails and maps groups");
  const group = list.nodes[3];
  assert.equal(group.nodes[0].id, "space-api");
  assert.deepEqual(group.nodes.slice(1), ["api tab 1", "api tab 2"]);
  show("notes");
  h.mod.body(h.colors, true);
  assert.deepEqual(h.scrolled, [3, 4], "on the rail a space is its own row");
});

test("a shown space that isn't listed, as in a folded machine, doesn't scroll, and coming back does", () => {
  const { h, show } = scrolling();
  h.live.spaces.push({ id: "far", name: "far", folder: "/far", tabs: [], machine: "server", active: false });
  h.mod.shown.add("far");
  h.mod.folded.add("server");
  show("maps");
  h.mod.body(h.colors, false);
  show("far");
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [2], "after the local machine header");
  show("maps");
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [2, 2], "back to maps, which may have scrolled away meanwhile");
});

test("a change that follows a press in the list doesn't scroll; a later one does", () => {
  const { h, show } = scrolling();
  let now = 100000;
  vm.runInContext("Date", h.context).now = () => now;
  const list = find(h.mod.body(h.colors, false), "spaces-list");
  assert.deepEqual(h.scrolled, [0]);
  list.handlers.mouse_down_left();
  show("api");
  now += 200;
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [0], "the clicked row stays under the pointer");
  now += 5000;
  show("notes");
  h.mod.body(h.colors, false);
  assert.deepEqual(h.scrolled, [0, 3]);
});

// Space sorting. Times are when something in a tab last changed state, as Herdr gives them;
// they seed a tab the first time it's seen, and after that a change of status stamps it.
const tab = (id, changed_at = null, working_since = null, status = null) => ({ id, changed_at, working_since, status });
function sortable(stored) {
  const h = harness(stored);
  h.live.spaces = [
    { id: "trails", name: "trails", folder: "/trails", tabs: [tab("t1", 100)] },
    { id: "maps", name: "Maps", folder: "/maps", tabs: [tab("t2", null), tab("t3", 300)] },
    { id: "quiet", name: "quiet", folder: "/quiet", tabs: [tab("t4")] },
    { id: "api", name: "api", folder: "/api", tabs: [tab("t5", 200)] },
    { id: "idle", name: "Idle", folder: "/idle", tabs: [] },
  ];
  for (const sp of h.live.spaces) h.mod.shown.add(sp.id);
  // Each look is a second later, so changes stamped one after another don't tie.
  let clock = 1e12;
  vm.runInContext("Date", h.context).now = () => (clock += 1000);
  return h;
}
const ids = (h) => Array.from(h.mod.ordered(), (r) => r.w.id);

test("spaces keep Herdr's order until a sort is picked", () => {
  const h = sortable();
  assert.deepEqual(ids(h), ["trails", "maps", "quiet", "api", "idle"]);
  h.values["spaces.sort"] = "nonsense";
  assert.deepEqual(ids(h), ["trails", "maps", "quiet", "api", "idle"]);
});

test("Recent puts the space with the latest change first, and quiet ones after in Herdr's order", () => {
  const h = sortable();
  h.values["spaces.sort"] = "recent";
  assert.deepEqual(ids(h), ["maps", "api", "trails", "quiet", "idle"]);
  h.live.spaces[2].tabs[0].status = "working";
  assert.deepEqual(ids(h), ["quiet", "maps", "api", "trails", "idle"]);
});

test("Recent doesn't move a space when looking at it turns done into idle", () => {
  const h = sortable();
  h.values["spaces.sort"] = "recent";
  ids(h);
  h.live.spaces[0].tabs[0].status = "done";
  assert.deepEqual(ids(h), ["trails", "maps", "api", "quiet", "idle"], "finishing is a change");
  h.live.spaces[1].tabs[1].status = "working";
  assert.deepEqual(ids(h), ["maps", "trails", "api", "quiet", "idle"]);
  h.live.spaces[0].tabs[0].status = "idle";
  h.live.spaces[0].tabs[0].changed_at = 2e12;
  assert.deepEqual(ids(h), ["maps", "trails", "api", "quiet", "idle"], "seeing it isn't");
});

test("Recent keeps its order across a restart", () => {
  const stored = {};
  const h = sortable(stored);
  h.values["spaces.sort"] = "recent";
  ids(h);
  h.live.spaces[2].tabs[0].status = "working";
  assert.deepEqual(ids(h), ["quiet", "maps", "api", "trails", "idle"]);
  const again = sortable(stored);
  again.values["spaces.sort"] = "recent";
  // After a restart Herdr has no stamps of its own.
  for (const sp of again.live.spaces) for (const t of sp.tabs) t.changed_at = null;
  again.live.spaces[2].tabs[0].status = "working";
  assert.deepEqual(ids(again), ["quiet", "maps", "api", "trails", "idle"]);
});

test("a sorted list holds still while a row is pressed, and the pressed row doesn't fade", () => {
  const h = sortable();
  h.values["spaces.sort"] = "recent";
  const tree = h.mod.body(h.colors, false);
  find(tree, "space-api").handlers.mouse_down_left({}, h.cx);
  find(tree, "space-trails").handlers.mouse_move({}, h.cx);
  h.live.spaces[2].tabs[0].status = "working";
  assert.deepEqual(ids(h), ["maps", "api", "trails", "quiet", "idle"], "held while pressed");
  const pressed = find(h.mod.body(h.colors, false), "space-api");
  assert.ok(!JSON.stringify(pressed).includes('"opacity"'), "not faded like a drag");
  pressed.handlers.mouse_up_left({}, h.cx);
  assert.deepEqual(JSON.parse(JSON.stringify(h.commands)), [{ name: "space.select", args: { id: "api" } }]);
  assert.deepEqual(ids(h), ["quiet", "maps", "api", "trails", "idle"], "moves once released");
});

test("Name sorts A to Z, case aside", () => {
  const h = sortable();
  h.values["spaces.sort"] = "name";
  assert.deepEqual(ids(h), ["api", "idle", "maps", "quiet", "trails"]);
});

test("a worktree stays under its main space, which sorts by the latest change in either", () => {
  const h = harness();
  h.live.spaces = [
    { id: "main", name: "repo", folder: "/repo", tabs: [tab("a", 10)] },
    { id: "other", name: "other", folder: "/other", tabs: [tab("b", 50)] },
    { id: "child", name: "feature", folder: "/tree", tabs: [tab("c", 90)] },
  ];
  for (const sp of h.live.spaces) h.mod.shown.add(sp.id);
  h.mod.git['[null,"/repo"]'] = { repo: '[null,"/repo/.git"]', linked: false, branch: "main" };
  h.mod.git['[null,"/tree"]'] = { repo: '[null,"/repo/.git"]', linked: true, branch: "feature" };
  h.values["spaces.sort"] = "recent";
  const rows = h.mod.ordered();
  assert.deepEqual(Array.from(rows, (r) => r.w.id), ["main", "child", "other"]);
  assert.equal(rows[0].kids, 1);
  assert.ok(rows[1].tree);
  h.values["spaces.sort"] = "name";
  assert.deepEqual(ids(h), ["other", "main", "child"]);
});

test("the sort menu sits beside New space, shows the choice, and remembers a pick", () => {
  const h = sortable();
  const header = h.mod.header(h.colors, false);
  const trigger = find(header, "space-sort");
  assert.ok(trigger, "the menu's button is in the header");
  assert.ok(find(header, "space-new"), "beside New space");
  h.mod.sortOpen = true;
  const open = h.mod.header(h.colors, false);
  assert.match(text(find(open, "space-sort-menu-body")), /Sort spaces\s+Manual\s+Recent\s+Name/);
  const checked = (tree, id) => JSON.stringify(find(tree, id), (k, v) => (k === "svgPath" || typeof v !== "string" ? v : undefined)).includes("icons/check.svg");
  const icon = (tree) => JSON.stringify(find(tree, "space-sort")).match(/icons\/([a-z-]+)\.svg/)?.[1];
  assert.ok(checked(open, "space-sort-manual") && !checked(open, "space-sort-recent"), "Manual is ticked");
  assert.equal(icon(open), "grip-vertical");
  find(open, "space-sort-recent").handlers.click({}, h.cx);
  assert.equal(h.values["spaces.sort"], "recent");
  assert.equal(h.mod.sortOpen, false);
  h.mod.sortOpen = true;
  const after = h.mod.header(h.colors, false);
  assert.ok(checked(after, "space-sort-recent") && !checked(after, "space-sort-manual"), "Recent is ticked");
  assert.equal(icon(after), "clock");
  assert.deepEqual(ids(h), ["maps", "api", "trails", "quiet", "idle"]);
});

test("dragging moves a space only in Herdr's order; sorted, a press just selects", () => {
  const h = sortable();
  const drag = (from, to) => {
    const rows = h.mod.ordered();
    const tree = h.mod.body(h.colors, false);
    find(tree, `space-${rows[from].w.id}`).handlers.mouse_down_left({}, h.cx);
    find(tree, `space-${rows[to].w.id}`).handlers.mouse_move({}, h.cx);
    find(h.mod.body(h.colors, false), `space-${rows[to].w.id}`).handlers.mouse_up_left({}, h.cx);
  };
  drag(0, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(h.commands.at(-1))), { name: "space.move", args: { id: "trails", index: 4 } });
  h.commands.length = 0;
  h.values["spaces.sort"] = "recent";
  drag(0, 2);
  assert.equal(h.commands.length, 0);
  const first = h.mod.ordered()[0].w.id;
  const tree = h.mod.body(h.colors, false);
  find(tree, `space-${first}`).handlers.mouse_down_left({}, h.cx);
  find(h.mod.body(h.colors, false), `space-${first}`).handlers.mouse_up_left({}, h.cx);
  assert.deepEqual(JSON.parse(JSON.stringify(h.commands)), [{ name: "space.select", args: { id: "maps" } }]);
});

