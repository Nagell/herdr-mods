// The lists view: spaces and agents in one block, under tabs or one above the other.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

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

async function harness({ settings = {}, tab = null, panes = [], sharedValues = {} } = {}) {
  const pending = [];
  const stored = { "lists.tab": tab };
  const live = { order: [] };
  const tabOf = (id) => ({ id, name: id });
  const spaces = [
    { id: "shop", name: "shop", folder: "/shop", tabs: [tabOf("a"), tabOf("b"), tabOf("d")] },
    { id: "docs", name: "docs", folder: "/docs", tabs: [tabOf("c")] },
  ];
  const agent = (address, space, tab, status) => ({
    address,
    space,
    space_name: space,
    tab,
    tab_name: { a: "1", b: "2", c: "1" }[tab],
    program: { name: "Claude Code" },
    status,
    pane: `p-${address}`,
    seq: 1,
  });
  const agents = [agent("t1", "shop", "a", "idle"), agent("t2", "docs", "c", "done"), agent("t3", "shop", "b", "blocked")];
  const cx = { notify() {}, stop_propagation() {}, timer: { every() {} }, focus_handle: () => ({}), spawn: (fn) => pending.push(fn(cx)) };
  const context = {
    Date, JSON, Map, Set, Math, console,
    View: class {},
    div: element, svg: (p) => element().child(`svg:${p}`), image: element, v_flex: element, h_flex: element,
    Popover: { new: element },
    spaces: () => spaces,
    agents: () => agents,
    terminals: () => [],
    panes: () => panes,
    focused: () => null,
    machines: () => [],
    theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true, platform: "macos" }),
    props: () => ({ view: "lists" }),
    shared: (k) => sharedValues[k],
    setShared() {},
    setAgentOrder: (list) => (live.order = [...list]),
    run() {},
    openOverlay() {},
    hc: async () => ({ code: 0, stdout: '{"machines":[]}' }),
    watchFolder: async () => { throw Error("No watcher in tests"); },
    exec: async () => ({ code: 1, stdout: "" }),
    appHome: () => "/app",
    readTextFile: async () => JSON.stringify({ settings }),
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
  };
  vm.createContext(context);
  // Each file in its own scope, as a module is; its exports become globals for the next.
  for (const file of ["settings.js", "git/pr-status.js", "git/checkouts.js", "views/find-node.js", "views/ui.js", "views/spaces.js", "views/agents.js", "views/lists.js"]) {
    const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
    vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
  }
  const mod = new context.Lists();
  mod.init({}, cx);
  while (pending.length) await Promise.all(pending.splice(0));
  return { mod, live, stored, cx };
}

const find = (node, id) => (node?.id === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const ids = (node, out = []) => (node?.id && out.push(node.id), (node?.nodes ?? []).forEach((n) => ids(n, out)), out);
const text = (node) => (typeof node === "string" ? node : (node?.nodes ?? []).map(text).join(" "));

test("Spaces shows each space's tabs beneath it, as their agents where they have any, and next-agent keys follow that order", async () => {
  const { mod, live } = await harness();
  const drawn = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w)$/.test(id));
  assert.deepEqual(drawn, ["space-shop", "ag-t1", "ag-t3", "tab-d", "space-docs", "ag-t2"]);
  // Its tab's title, then its program, quietly.
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+Claude Code/);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);
});

test("the Agents tab counts agents, and picking a tab keeps it", async () => {
  const { mod, stored, cx } = await harness();
  const root = mod.render();
  assert.match(text(find(root, "lists-tab-agents")), /Agents 3/);
  assert.equal(find(root, "lists-tab-unread"), undefined);
  find(root, "lists-tab-agents").handlers.click({}, cx);
  assert.equal(stored["lists.tab"], "agents");
});

test("the tab picked last comes back, and an old Unread one falls back to Spaces", async () => {
  assert.ok(find((await harness({ tab: "unread" })).mod.render(), "space-shop"));
  const { mod } = await harness({ tab: "agents" });
  const root = mod.render();
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-shop"), undefined);
});

test("combined off puts spaces above agents, without tabs", async () => {
  const { mod } = await harness({ settings: { combined: false } });
  const root = mod.render();
  assert.equal(find(root, "lists-tab-spaces"), undefined);
  assert.ok(find(root, "space-shop"));
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-agents-shop"), undefined);
});

test("in Spaces a pinned agent sits above every space", async () => {
  const { mod } = await harness();
  mod.agents.setPins(["t3"]);
  const drawn = ids(mod.render()).filter((id) => /^ag-t\d$/.test(id));
  assert.deepEqual(drawn, ["ag-t3", "ag-t1", "ag-t2"]);
  const order = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d)$/.test(id));
  assert.deepEqual(order, ["ag-t3", "space-shop", "ag-t1", "space-docs", "ag-t2"]);

});

test("an Agents row reads its tab's title, then its space", async () => {
  const { mod } = await harness({ tab: "agents" });
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+shop/);
});

test("a mod's tab shows the icon the mod publishes, and a tab with neither keeps the gap", async () => {
  const { mod } = await harness({
    panes: [{ pane: "pd", tab: "d", mod: "better-files" }],
    sharedValues: { "mod-icons": { "better-files": "mods/better-files/icons/file.svg" } },
  });
  assert.match(text(find(mod.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
  const { mod: bare } = await harness();
  assert.doesNotMatch(text(find(bare.render(), "tab-d")), /svg:/);
});
