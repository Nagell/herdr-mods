const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

function harness(view) {
  const live = { agents: [], spaces: [], shared: {}, commands: [], root: null };
  const overlays = [], order = [], commands = [];
  function element() {
    const node = { nodes: [], handlers: {} };
    const proxy = new Proxy(node, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "child") return (c) => (target.nodes.push(c), proxy);
        if (key === "children") return (c) => (target.nodes.push(...c), proxy);
        if (key === "when") return (c, build) => (c && build(proxy), proxy);
        return (...args) => {
          if (key === "id") target.id = args[0];
          if (key === "on_click") target.handlers.click = args[0];
          return proxy;
        };
      },
    });
    return proxy;
  }
  const colors = new Proxy({}, { get: (_t, k) => String(k) });
  const context = {
    Date, JSON, Map, Set, Math, console,
    div: element, svg: element, image: element, v_flex: element, h_flex: element,
    agents: () => live.agents,
    terminals: () => [],
    panes: () => [],
    focused: () => null,
    spaces: () => live.spaces,
    run: (name, args) => commands.push({ name, args }),
    theme: () => colors,
    shared: (key) => live.shared[key],
    setShared: (key, value) => { live.shared[key] = value; },
    setAgentOrder: (list) => { order.length = 0; order.push(...list); },
    openOverlay: (spec) => overlays.push(spec),
    closeOverlay() {},
    props: () => ({ view }),
    window: () => ({ platform: "macos" }),
    layout: () => live.root ?? { id: "sidebar", size: { px: 268 } },
    updates: () => ({ app: { ready: live.updateReady } }),
    nextCommand: () => new Promise((resolve) => live.commands.push(resolve)),
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(context);
  return { live, overlays, order, commands, context };
}

function load(h, file, name) {
  const source = fs
    .readFileSync(path.join(runtime, file), "utf8")
    .replace(/^import\s+[\s\S]*?;\n/gm, "")
    .replaceAll("export ", "");
  vm.runInContext(`${source}\nglobalThis.${name} = ${name}; globalThis.namePrefix = typeof namePrefix === "function" ? namePrefix : undefined;`, h.context);
  return new h.context[name]();
}

const find = (node, id) => (node?.id === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const strings = (node) => (typeof node === "string" ? node : (node?.nodes ?? []).map(strings).join(" "));
const cx = { timer: { every() {} }, notify() {}, stop_propagation() {} };

function agents(sort) {
  const h = harness("agents");
  const mod = load(h, "agents.js", "Agents");
  mod.init({}, cx);
  h.live.shared["agents.sort"] = sort;
  const tab = (id, name) => ({ id, name });
  h.live.spaces = [
    { id: "shop", name: "shop", tabs: [tab("a", "Work"), tab("f", "INS-7 fix")] },
    { id: "wt", name: "PR-6", tabs: [tab("b", "Review")] },
    { id: "plat", name: "PLAT-2", tabs: [tab("c", "Work")] },
    { id: "notes", name: "herdr-mods", tabs: [tab("d", "Notes")] },
    { id: "wt2", name: "PR-9", tabs: [tab("e", "INS-1")] },
  ];
  const agent = (address, space, space_name, tabId, status = "idle") => ({ address, space, space_name, tab: tabId, status, pane: `p-${address}`, seq: 1 });
  h.live.agents = [
    agent("t1", "shop", "shop", "a", "blocked"),
    agent("t2", "wt", "PR-6", "b"),
    agent("t3", "plat", "PLAT-2", "c"),
    agent("t4", "notes", "herdr-mods", "d"),
    agent("t5", "wt2", "PR-9", "e"),
    agent("t6", "shop", "shop", "f"),
  ];
  h.live.shared["better-sidebar.space-parents"] = {
    shop: { key: "repo1", label: "shop" },
    wt: { key: "repo1", label: "shop" },
    wt2: { key: "repo1", label: "shop" },
    plat: { key: "repo2", label: "platform" },
  };
  return { h, mod };
}

// Headers and agents in the order drawn.
const rows = (tree) => find(tree, "ag-list").nodes.map((n) => n.id);

test("name prefixes are ticket-like, in either case when numbered", () => {
  const h = harness("agents");
  load(h, "agents.js", "Agents");
  const prefix = h.context.namePrefix;
  assert.equal(prefix("PR-12"), "PR");
  assert.equal(prefix("pr-12"), "PR");
  assert.equal(prefix("INS-4 fix login"), "INS");
  assert.equal(prefix("PLAT-work"), "PLAT");
  assert.equal(prefix("feature/INS-4-login"), "INS");
  assert.equal(prefix("herdr-mods"), null);
  assert.equal(prefix("Fix PR-12"), null);
  assert.equal(prefix(null, undefined), null);
  assert.equal(prefix("herdr-mods", "INS-9"), "INS", "the tab name counts too");
  assert.equal(prefix("PR-1", "INS-9"), "PR", "the space name wins");
});

test("group by main space gathers worktrees under their main space", () => {
  const { h, mod } = agents("parent");
  const list = rows(mod.render(cx));
  assert.deepEqual(list, ["repo-repo1", "ag-t1", "ag-t2", "ag-t5", "ag-t6", "repo-repo2", "ag-t3", "sp-notes", "ag-t4"]);
  assert.deepEqual([...h.order], ["t1", "t2", "t5", "t6", "t3", "t4"], "next-agent keys follow what is drawn");
  const tree = mod.render(cx);
  assert.match(strings(find(tree, "repo-repo1")), /shop/);
  assert.match(strings(find(tree, "ag-t2")), /PR-6/, "the row names its worktree");
});

test("group by prefix reads the space and tab names, with the rest last", () => {
  const { h, mod } = agents("prefix");
  const tree = mod.render(cx);
  assert.deepEqual(rows(tree), ["prefix-INS", "ag-t6", "prefix-PLAT", "ag-t3", "prefix-PR", "ag-t2", "ag-t5", "prefix-none", "ag-t1", "ag-t4"]);
  assert.deepEqual([...h.order], ["t6", "t3", "t2", "t5", "t1", "t4"]);
  assert.match(strings(find(tree, "prefix-PR")), /PR-/);
  assert.match(strings(find(tree, "prefix-none")), /No prefix/);
});

test("priority and group by space keep working, and pinned agents stay on top", () => {
  const { mod, h } = agents("priority");
  assert.equal(rows(mod.render(cx))[0], "sec-4");
  h.live.shared["agents.sort"] = "grouped";
  mod.setPins(["t5"]);
  assert.deepEqual(rows(mod.render(cx)).slice(0, 4), ["pinned", "ag-t5", "sp-shop", "ag-t1"]);
  h.live.shared["agents.sort"] = "prefix";
  assert.deepEqual(rows(mod.render(cx)).slice(0, 2), ["pinned", "ag-t5"]);
});

test("without parents published, main space grouping falls back to each space", () => {
  const { mod, h } = agents("parent");
  delete h.live.shared["better-sidebar.space-parents"];
  assert.ok(rows(mod.render(cx)).includes("sp-wt"));
});

test("the group menu opens through this mod and offers all four", () => {
  const { h, mod } = agents("priority");
  find(mod.render(cx), "ag-sort").handlers.click({}, cx);
  assert.equal(h.overlays[0].mod, "better-sidebar");
  assert.equal(h.overlays[0].props.view, "agents");
  const menu = harness("agents");
  menu.context.props = () => ({ view: "agents", sortMenu: true, overlay: "o" });
  const view = load(menu, "agents.js", "Agents");
  view.init({}, cx);
  const tree = view.render(cx);
  for (const id of ["priority", "grouped", "parent", "prefix"]) assert.ok(find(tree, `sort-${id}`), id);
  find(tree, "sort-prefix").handlers.click({}, cx);
  assert.equal(menu.live.shared["agents.sort"], "prefix");
});

test("the footer is one line of icons that still reaches Settings and Add machine", () => {
  const h = harness("footer");
  const footer = load(h, "footer.js", "Footer");
  footer.init();
  const tree = footer.render();
  find(tree, "settings").handlers.click({}, cx);
  find(tree, "machine").handlers.click({}, cx);
  assert.equal(h.commands[0].name, "app.settings");
  assert.equal(h.commands[1].name, "mod.open");
  assert.equal(h.commands[1].args.name, "machine-add");
  assert.equal(strings(tree).trim(), "", "icons only, labels live in the tooltips");
  assert.equal(find(tree, "settings").nodes.length, 1);
  h.live.updateReady = true;
  assert.equal(find(footer.render(), "settings").nodes.length, 2, "a ready update adds its dot");
});

test("the panel toggle hides the right panel by click and key, and names what it will do", async () => {
  const h = harness("panel-toggle");
  const toggle = load(h, "panel-toggle.js", "PanelToggle");
  const spawned = [];
  toggle.init({}, { spawn: (fn) => spawned.push(fn()) });
  h.live.root = { id: "root", children: [{ id: "panel", hidden: false }] };
  find(toggle.render(), "panel-toggle").handlers.click({}, cx);
  assert.deepEqual({ ...h.commands[0] }, { name: "layout.toggle", args: h.commands[0].args });
  assert.equal(h.commands[0].args.id, "panel");
  h.live.commands.shift()("toggle-panel");
  await new Promise(setImmediate);
  assert.equal(h.commands.length, 2, "the key command does the same");
  h.live.commands.shift()("something-else");
  await new Promise(setImmediate);
  assert.equal(h.commands.length, 2);
  h.live.root = { id: "root", children: [{ id: "panel", hidden: true }] };
  assert.ok(find(toggle.render(), "panel-toggle"));
  h.live.root = { id: "root", children: [] };
  assert.equal(find(toggle.render(), "panel-toggle"), undefined, "no panel, no button");
});
