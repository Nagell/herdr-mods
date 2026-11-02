const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-spaces");

// Inspect fluent GPUI descriptions without opening a window. Timers do not run
// automatically; flush() waits for spawned reads, making races deterministic.
function harness() {
  const live = { spaces: [], panes: [], machines: [] };
  const pending = [],
    calls = [],
    commands = [],
    overlays = [],
    values = {};
  const colors = {
    foreground: "white",
    dim: "gray",
    ansi1: "red",
    ansi2: "green",
    ansi5: "purple",
  };
  function element() {
    const node = { nodes: [], handlers: {}, attributes: {} };
    let proxy;
    proxy = new Proxy(node, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "child")
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
    timer: { every() {} },
    spawn(fn) {
      pending.push(fn(cx));
    },
  };
  const context = {
    View: class {},
    div: element,
    svg: element,
    h_flex: element,
    v_flex: element,
    spaces: () => live.spaces,
    panes: () => live.panes,
    machines: () => live.machines,
    theme: () => colors,
    settings: () => ({ ui_font_size: 13 }),
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true }),
    shared: (key) => values[key],
    setShared: (key, value) => {
      values[key] = value;
    },
    run: (name, args) => commands.push({ name, args }),
    openOverlay: (args) => overlays.push(args),
    localStorage: { getItem: () => null, setItem() {} },
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
  for (const file of ["typography.js", "pr-status.js", "main.js"]) {
    const source = fs
      .readFileSync(path.join(runtime, file), "utf8")
      .replace(/^import\s+[\s\S]*?;\n/gm, "")
      .replace("export default class Spaces", "globalThis.Spaces = class Spaces")
      .replaceAll("export ", "");
    vm.runInContext(source, context);
  }
  const mod = new context.Spaces();
  mod.init({}, cx);
  return {
    live,
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

test("PR appearance distinguishes open, draft, merged, closed, and failed checks", () => {
  const h = harness();
  h.context.colors = h.colors;
  for (const [pr, icon, color] of [
    [{ state: "OPEN" }, "pull-request", "green"],
    [{ state: "OPEN", isDraft: true }, "draft", "gray"],
    [{ state: "MERGED", isDraft: true }, "merged", "purple"],
    [{ state: "CLOSED" }, "closed", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ conclusion: "FAILURE" }] }, "pull-request", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ state: "ERROR" }] }, "pull-request", "red"],
    [{ state: "OPEN", statusCheckRollup: [{ status: "IN_PROGRESS" }] }, "pull-request", "green"],
  ]) {
    h.context.pr = pr;
    const appearance = vm.runInContext("prAppearance(pr, colors)", h.context);
    assert.equal(appearance.icon, icon);
    assert.equal(appearance.color, color);
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

test("space rows align branches right and show their own PR underneath", () => {
  const h = harness();
  const space = { id: "main", name: "repo", folder: "/repo", tabs: [{ id: "tab", active: true }] };
  h.live.spaces = [space];
  h.live.panes = [{ tab: "tab", cwd: "/repo", branch: "main" }];
  const g = { branch: "main", name: "repo" };
  h.mod.git['[null,"/repo"]'] = g;
  h.observer.entries.set('[null,"/repo"]', {
    branch: "main",
    prs: [{ number: 42, repository: "owner/repo", title: "Fix", state: "OPEN" }],
  });
  const row = h.mod.row({ w: space, i: 0, g, tree: null }, h.colors);
  assert.match(text(row), /repo main/);
  assert.match(text(find(row, "space-pr-line-main")), /#42 · Open/);
  assert.ok("justify_end" in h.mod.gitTail(g, null, "repo", h.colors).attributes);
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
  const source = fs.readFileSync(path.join(runtime, "main.js"), "utf8");
  assert.doesNotMatch(
    source,
    /mods\/(?:pull-requests|workspace-chrome|factory-spaces)|herdr-pr|appHome\(/,
  );
  const imports = [...source.matchAll(/mods\/([^/]+)\//g)];
  assert.ok(imports.every((match) => match[1] === "better-spaces"));
  for (const icon of [
    "branch",
    "server",
    "monitor",
    "chevron-down",
    "chevron-right",
    "plus",
    "pull-request",
    "draft",
    "merged",
    "closed",
  ]) {
    assert.ok(fs.existsSync(path.join(runtime, `${icon}.svg`)), icon);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, "mod.json"))).place, "none");
  assert.equal(fs.existsSync(path.join(__dirname, "../layouts")), false);
});
