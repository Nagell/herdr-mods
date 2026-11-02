const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../mods/better-tabs");

function harness(config = {}) {
  const calls = [],
    data = {},
    storage = new Map(),
    timers = [];
  const tree = {
    id: "root",
    children: [
      {
        id: "panel",
        hidden: false,
        children: [
          { id: "panel-body", active: "files", children: [{ id: "files" }, { id: "changes" }] },
        ],
      },
      { id: "center", active: "main", children: [{ id: "main" }, { id: "browser" }] },
    ],
  };
  let panes = [];
  let spaces = [
    {
      id: "a",
      active: true,
      tabs: [
        { id: "t1", name: "One", active: true },
        { id: "t2", name: "Two" },
      ],
    },
  ];
  function element() {
    const value = { kids: [], handlers: {}, attrs: {} };
    const proxy = new Proxy(value, {
      get(o, k) {
        if (k in o) return o[k];
        return (...args) => {
          if (k === "child") o.kids.push(args[0]);
          else if (k === "children") o.kids.push(...args[0]);
          else if (k === "when") {
            if (args[0]) args[1](proxy);
          } else if (k === "id") o.key = args[0];
          else if (k.startsWith("on_"))
            o.handlers[k + (typeof args[0] === "string" ? ":" + args[0] : "")] = args.at(-1);
          else o.attrs[k] = args;
          return proxy;
        };
      },
    });
    return proxy;
  }
  const context = {
    View: class {},
    div: element,
    svg: element,
    image: element,
    h_flex: element,
    v_flex: element,
    em: (n) => n * 14,
    props: () => config,
    layout: () => tree,
    spaces: () => spaces,
    panes: () => panes,
    shared: (key) => data[key],
    setShared: (key, value) => (data[key] = value),
    run: (name, args) => calls.push({ name, args }),
    openOverlay: (args) => calls.push({ overlay: args }),
    closeOverlay: (id) => calls.push({ close: id }),
    notify: (args) => calls.push({ notify: args }),
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    window: () => ({ platform: "macos" }),
    settings: () => ({ zoom: 1 }),
    theme: () => ({}),
    nextCommand: () => new Promise(() => {}),
    Date,
    console,
  };
  vm.createContext(context);
  const load = (name) =>
    fs
      .readFileSync(path.join(root, name), "utf8")
      .replace(/^import\s+[\s\S]*?;\n/gm, "")
      .replaceAll("export function ", "function ")
      .replace("export const hooks", "const hooks")
      .replace("export default class Tabs", "globalThis.Tabs = class Tabs");
  vm.runInContext(
    load("hooks.js") +
      "\n" +
      load("actions.js") +
      "\n" +
      load("toolbar.js") +
      "\n" +
      load("main.js") +
      "\nglobalThis.api = {execute, buttons, matches, isActive, find, hooks, toolbarPartition, toolbarPreferences, hideToolbarAction, placeToolbarAction, tabMoveIndex};",
    context,
  );
  const cx = {
    spawn: () => {},
    notify: () => {},
    stop_propagation: () => {},
    timer: { every: (ms, fn) => timers.push(fn) },
  };
  const tabs = new context.Tabs();
  tabs.init({}, cx);
  function find(el, id) {
    if (el?.key === id) return el;
    for (const child of el?.kids ?? []) {
      const found = find(child, id);
      if (found) return found;
    }
  }
  return {
    ...context.api,
    tabs,
    context,
    calls,
    data,
    tree,
    config,
    storage,
    timers,
    cx,
    find,
    setSpaces: (s) => (spaces = s),
    setPanes: (p) => (panes = p),
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("panel actions toggle containers and reject missing targets without dispatch", () => {
  const h = harness(),
    action = { type: "panel", container: "panel", stack: "panel-body", target: "changes" };
  h.execute(action);
  assert.deepEqual(plain(h.calls), [
    { name: "layout.select", args: { stack: "panel-body", child: "changes" } },
    { name: "layout.show", args: { id: "panel" } },
  ]);
  h.findNode = h.tree.children[0].children[0];
  h.findNode.active = "changes";
  h.execute(action);
  assert.equal(h.calls.at(-1).name, "layout.hide");
  const count = h.calls.length;
  assert.throws(() => h.execute({ ...action, target: "missing" }));
  assert.equal(h.calls.length, count);
});
test("mod-tab opens once with the focused checkout, reuses, and recreates after closing", () => {
  const h = harness(),
    action = { type: "mod-tab", mod: "example", name: "All items", props: { mode: "browser" } };
  const space = { id: "a", folder: "/main", tabs: [{ id: "shell", active: true }] };
  h.setPanes([{ tab: "shell", cwd: "/worktree", focused: true }]);
  h.execute(action, { space });
  assert.equal(h.calls[0].name, "tab.new");
  assert.equal(h.calls[0].args.props.source.cwd, "/worktree");
  h.execute(action, { space });
  assert.equal(h.calls.length, 1);
  space.tabs.push({ id: "browser" });
  h.setPanes([{ tab: "browser", mod: "example" }]);
  h.execute(action, { space });
  assert.equal(h.calls.at(-1).name, "tab.select");
  assert.equal(h.calls.at(-1).args.id, "browser");
  h.setPanes([]);
  h.data["better-tabs.mod-tabs"][JSON.stringify(["a", "example"])].pending = 1;
  h.execute(action, { space });
  assert.equal(h.calls.at(-1).name, "tab.new");
});

test("generic stack toggle preserves other layout children", () => {
  const h = harness(),
    action = { type: "toggle-stack", stack: "center", child: "browser", fallback: "main" };
  h.execute(action);
  assert.equal(h.calls.at(-1).args.child, "browser");
  h.tree.children[1].active = "browser";
  h.execute(action);
  assert.equal(h.calls.at(-1).args.child, "main");
});
test("commands, overlays, shared updates, and sequences dispatch in order", () => {
  const h = harness();
  h.execute({
    type: "sequence",
    actions: [
      { type: "command", name: "tab.new", args: { name: "Example" } },
      { type: "overlay", mod: "example", kind: "dialog", props: { x: 1 } },
      { type: "shared", key: "example.flag", toggle: true },
    ],
  });
  assert.equal(h.calls[0].name, "tab.new");
  assert.equal(h.calls[1].overlay.mod, "example");
  assert.equal(h.data["example.flag"], true);
});
test("sequences have a recursion bound and hooks are explicit trusted handlers", () => {
  const h = harness();
  const loop = { type: "sequence" };
  loop.actions = [loop];
  assert.throws(() => h.execute(loop), /nested/);
  assert.throws(() => h.execute({ type: "hook", name: "toString" }), /Unknown/);
  h.hooks.example = (args, context) => {
    assert.equal(args.x, 1);
    assert.equal(context.space, "a");
  };
  h.execute({ type: "hook", name: "example", args: { x: 1 } }, { space: "a" });
});
test("async hook failures are reported directly and inside action sequences", async () => {
  const h = harness();
  h.hooks.fail = async () => {
    throw Error("Hook failed");
  };
  h.tabs.act({ type: "hook", name: "fail" }, h.cx);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(h.calls.at(-1).notify.body, /Hook failed/);
  h.calls.length = 0;
  h.tabs.act(
    {
      type: "sequence",
      actions: [
        { type: "hook", name: "fail" },
        { type: "command", name: "tab.new" },
      ],
    },
    h.cx,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls[0].name, "tab.new");
  assert.match(h.calls.at(-1).notify.body, /Hook failed/);
});

test("contributions are opt-in; layout IDs win and predicates/order apply", () => {
  const h = harness(),
    config = { buttons: [{ id: "own", label: "Own", order: 5 }] };
  const extra = {
    mod: [
      { id: "own", label: "Wrong" },
      { id: "other", order: 1 },
      { id: "hidden", when: { shared: "hide" } },
    ],
  };
  assert.equal(h.buttons(config, extra).length, 1);
  config.contributions = true;
  assert.deepEqual(
    plain(h.buttons(config, extra)).map((b) => b.id),
    ["other", "own"],
  );
  assert.equal(h.buttons(config, extra)[1].label, "Own");
});
test("keyboard button hooks honor enabled conditions and named command aliases", () => {
  const h = harness({
    buttons: [{ id: "x", disabled: true, action: { type: "command", name: "tab.new" } }],
    commands: {
      toggle: { type: "toggle-stack", stack: "center", child: "browser", fallback: "main" },
    },
  });
  h.tabs.command("button:x", h.cx);
  assert.equal(h.calls.length, 0);
  h.tabs.command("toggle", h.cx);
  assert.equal(h.calls[0].args.child, "browser");
});
test("malformed local storage is harmless and per-space memory restores panels outside render", () => {
  const h = harness();
  const key = JSON.stringify(["panel", "panel-body", "b"]);
  h.tabs.panels[key] = "changes";
  h.setSpaces([{ id: "b", active: true, tabs: [] }]);
  h.tabs.syncPanel();
  assert.equal(h.calls[0].args.child, "changes");
  h.calls.length = 0;
  h.tabs.render(h.cx);
  assert.equal(h.calls.length, 0);
  h.storage.set("panels", "{broken");
  h.tabs.init({}, h.cx);
  assert.equal(typeof h.tabs.panels, "object");
});
test("tabs select, drag reorder, rename, close, and open context menus", () => {
  const h = harness({ buttons: [] });
  let el = h.tabs.render(h.cx);
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ click_count: 2 }, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.rename");
  const start = { position: { x: 20, y: 15 }, click_count: 1 };
  const drop = {
    position: { x: 180, y: 15 },
    local_position: { x: 80, y: 15 },
    bounds: { x: 100, y: 0, width: 100, height: 30 },
  };
  h.find(el, "tab-t1").handlers["on_mouse_down:left"](start, h.cx);
  h.find(el, "tab-t2").handlers.on_mouse_move(drop, h.cx);
  assert.ok(h.find(h.tabs.render(h.cx), "drag-preview"));
  h.find(el, "tab-t2").handlers["on_mouse_up:left"](drop, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.move");
  h.tabs.ignoreClickUntil = 0;
  h.find(el, "close-t1").handlers.on_click({}, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.close");
  h.find(el, "tab-t2").handlers["on_mouse_down:left"]({}, h.cx);
  h.find(el, "tab-t2").handlers["on_mouse_up:left"]({}, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.select");
  h.find(el, "tab-t2").handlers["on_mouse_down:right"]({}, h.cx);
  assert.equal(h.calls.at(-1).overlay.mod, "menu");
});
test("overflow uses this mod and includes hidden-toolbar actions without contributions duplication", () => {
  const h = harness({
    maxButtons: 1,
    buttons: ["a", "b", "c"].map((id) => ({
      id,
      label: id,
      action: { type: "command", name: "tab.new" },
    })),
  });
  const el = h.tabs.render(h.cx);
  assert.ok(h.find(el, "action-a"));
  assert.equal(h.find(el, "action-b"), undefined);
  h.find(el, "actions-more").handlers.on_click({}, h.cx);
  const popup = h.calls.at(-1).overlay;
  assert.equal(popup.mod, "better-tabs");
  assert.deepEqual(
    plain(popup.props.buttons).map((b) => b.id),
    ["b", "c"],
  );
  assert.equal(popup.props.contributions, false);
});
test("overflow action closes itself and dispatches the action", () => {
  const h = harness({
    mode: "overflow",
    overlay: "overlay1",
    buttons: [{ id: "new", action: { type: "command", name: "tab.new" } }],
  });
  h.find(h.tabs.render(h.cx), "action-new").handlers.on_click({}, h.cx);
  assert.equal(h.calls[0].close, "overlay1");
  assert.equal(h.calls[1].name, "tab.new");
});
test("new-tab button sits directly after the tabs and overflow is always present", () => {
  const h = harness({ buttons: [] });
  const el = h.tabs.render(h.cx);
  const scroll = h.find(el, "tab-scroll");
  assert.deepEqual(
    scroll.kids.map((child) => child.key),
    ["tab-t1", "tab-t2", "tab-new"],
  );
  assert.ok(h.find(el, "actions-more"));
  h.find(el, "actions-more").handlers.on_click({}, h.cx);
  assert.equal(h.calls.at(-1).overlay.props.buttons.length, 0);
});

test("tab drag has a movement threshold, follows the pointer, and marks the insertion side", () => {
  const h = harness({ buttons: [] });
  let el = h.tabs.render(h.cx);
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ position: { x: 20, y: 15 } }, h.cx);
  h.find(el, "tab-t1").handlers.on_mouse_move(
    {
      position: { x: 22, y: 15 },
      local_position: { x: 22 },
      bounds: { x: 0, y: 0, width: 100, height: 30 },
    },
    h.cx,
  );
  assert.equal(h.find(h.tabs.render(h.cx), "drag-preview"), undefined);
  const hover = {
    position: { x: 160, y: 15 },
    local_position: { x: 60 },
    bounds: { x: 100, y: 0, width: 100, height: 30 },
  };
  h.find(el, "tab-t2").handlers.on_mouse_move(hover, h.cx);
  el = h.tabs.render(h.cx);
  assert.ok(h.find(el, "drop-indicator"));
  const firstX = h.find(el, "drag-preview").attrs.left[0];
  h.find(el, "better-tabs-root").handlers.on_mouse_move(
    { ...hover, position: { x: 180, y: 15 }, bounds: { x: 0, y: 0, width: 1200, height: 40 } },
    h.cx,
  );
  assert.notEqual(h.find(h.tabs.render(h.cx), "drag-preview").attrs.left[0], firstX);
  assert.equal(h.calls.length, 0);
  h.find(el, "tab-t2").handlers["on_mouse_up:left"](hover, h.cx);
  assert.deepEqual(plain(h.calls), [{ name: "tab.move", args: { id: "t1", index: 2 } }]);
  assert.equal(h.tabs.tabDrag, null);
});

test("tab insertion boundaries handle both directions and disappeared tabs", () => {
  const h = harness();
  const tabs = ["a", "b", "c"].map((id) => ({ id }));
  assert.equal(h.tabMoveIndex(tabs, "a", "c", true), 3);
  assert.equal(h.tabMoveIndex(tabs, "c", "a", false), 1);
  assert.equal(h.tabMoveIndex(tabs, "a", "b", false), null);
  assert.equal(h.tabMoveIndex(tabs, "b", "a", true), null);
  assert.equal(h.tabMoveIndex(tabs, "removed", "a", false), null);
});

test("leaving the bar cancels a tab drag instead of moving or selecting another tab", () => {
  const h = harness({ buttons: [] });
  const el = h.tabs.render(h.cx);
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ position: { x: 20, y: 15 } }, h.cx);
  h.find(el, "better-tabs-root").handlers.on_hover(false, h.cx);
  h.find(el, "tab-t2").handlers["on_mouse_up:left"]({}, h.cx);
  assert.equal(h.calls.length, 0);
});

test("dropping a terminal tab on a toolbar action cancels without activating it", () => {
  const h = harness();
  const el = h.tabs.render(h.cx);
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ position: { x: 20, y: 15 } }, h.cx);
  h.find(el, "better-tabs-root").handlers.on_mouse_move({ position: { x: 800, y: 15 } }, h.cx);
  h.find(el, "action-files").handlers["on_mouse_up:left"]({}, h.cx);
  h.find(el, "action-files").handlers.on_click({}, h.cx);
  assert.equal(h.tabs.tabDrag, null);
  assert.equal(h.calls.length, 0);
});

test("toolbar actions drop into overflow without activating and remain hidden after reinitialization", () => {
  const entries = ["z", "a", "m"].map((id) => ({
    id,
    label: id.toUpperCase(),
    action: { type: "command", name: "app.palette" },
  }));
  const h = harness({ buttons: entries });
  let el = h.tabs.render(h.cx);
  h.find(el, "action-z").handlers["on_mouse_down:left"]({ position: { x: 800, y: 15 } }, h.cx);
  h.find(el, "actions-more").handlers.on_mouse_move(
    { position: { x: 1100, y: 15 }, bounds: { x: 1080, y: 0, width: 26, height: 40 } },
    h.cx,
  );
  assert.ok(h.find(h.tabs.render(h.cx), "drag-preview"));
  h.find(el, "actions-more").handlers["on_mouse_up:left"]({}, h.cx);
  h.find(el, "action-z").handlers.on_click({}, h.cx);
  assert.equal(h.calls.length, 0);
  el = h.tabs.render(h.cx);
  assert.equal(h.find(el, "action-z"), undefined);
  assert.deepEqual(
    plain(h.tabs.toolbar().overflow).map((entry) => entry.id),
    ["z"],
  );
  h.tabs.init({}, h.cx);
  assert.equal(h.find(h.tabs.render(h.cx), "action-z"), undefined);
});

test("hidden actions sort alphabetically and can be pinned, including configured overflow actions", () => {
  const h = harness();
  const entries = [
    { id: "z", label: "Zulu" },
    { id: "b", label: "beta", overflow: true },
    { id: "a", label: "Alpha" },
  ];
  let saved = h.hideToolbarAction({}, "z");
  let result = h.toolbarPartition(entries, saved, 1);
  assert.deepEqual(
    plain(result.visible).map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(
    plain(result.overflow).map((entry) => entry.id),
    ["b", "z"],
  );
  saved = h.placeToolbarAction(entries, saved, "b");
  result = h.toolbarPartition(entries, saved, 1);
  assert.deepEqual(
    plain(result.visible).map((entry) => entry.id),
    ["b"],
  );
  saved = h.placeToolbarAction(entries, saved, "a", "b", true);
  assert.deepEqual(
    plain(h.toolbarPartition(entries, saved, 3).visible).map((entry) => entry.id),
    ["b", "a"],
  );
  assert.deepEqual(plain(h.toolbarPreferences({ hidden: ["x", "x", null], pinned: false })), {
    hidden: ["x"],
    pinned: [],
    order: [],
  });
});

test("overflow menu provides alphabetic entries and an explicit show-in-toolbar control", () => {
  const entries = ["z", "a"].map((id) => ({
    id,
    label: id,
    action: { type: "command", name: "app.palette" },
  }));
  const h = harness({ mode: "overflow", overlay: "popup", buttons: entries, allButtons: entries });
  const el = h.tabs.render(h.cx);
  assert.deepEqual(
    h
      .find(el, "actions-menu-list")
      .kids.filter((child) => typeof child.key === "string" && child.key.startsWith("action-"))
      .map((child) => child.key),
    ["action-a", "action-z"],
  );
  h.find(el, "pin-z").handlers.on_click({}, h.cx);
  assert.equal(h.tabs.preferences().pinned.includes("z"), true);
  assert.equal(h.calls.at(-1).close, "popup");
  assert.equal(
    h.calls.some((call) => call.name),
    false,
  );
});

test("overflow popup has explicit dimensions and an inner scroll list even for a single hidden PR", () => {
  const pr = { id: "pr", label: "PR", action: { type: "command", name: "app.palette" } };
  const bar = harness({ buttons: [pr] });
  bar.tabs.savePreferences(bar.hideToolbarAction({}, "pr"));
  bar.tabs.openActions(bar.tabs.toolbar().overflow);
  const popup = bar.calls.at(-1).overlay;
  const menu = harness(popup.props);
  const root = menu.tabs.render(menu.cx);
  assert.equal(root.attrs.w[0], popup.width);
  assert.equal(root.attrs.h[0], popup.height);
  assert.equal(root.attrs.h[0], 42);
  assert.ok(menu.find(root, "actions-menu-list").attrs.overflow_y_scrollbar);
  assert.ok(menu.find(root, "action-pr"));
  menu.find(root, "action-pr").handlers.on_click({}, menu.cx);
  assert.equal(menu.calls.at(-1).name, "app.palette");
});

test("dragging an overflow entry out closes the menu and allows insertion back on the toolbar", () => {
  const entries = ["a", "b"].map((id) => ({
    id,
    label: id,
    action: { type: "command", name: "app.palette" },
  }));
  const menu = harness({
    mode: "overflow",
    overlay: "popup",
    buttons: [entries[1]],
    allButtons: entries,
  });
  const el = menu.tabs.render(menu.cx);
  menu
    .find(el, "action-b")
    .handlers["on_mouse_down:left"]({ position: { x: 900, y: 90 } }, menu.cx);
  menu.find(el, "actions-menu").handlers.on_hover(false, menu.cx);
  assert.equal(menu.calls.at(-1).close, "popup");
  assert.equal(menu.tabs.actionDrag().active, true);

  const bar = harness({ buttons: entries });
  Object.assign(bar.data, menu.data);
  bar.tabs.savePreferences(bar.hideToolbarAction({}, "b"));
  const toolbar = bar.tabs.render(bar.cx);
  bar.find(toolbar, "action-a").handlers.on_mouse_move(
    {
      position: { x: 850, y: 15 },
      local_position: { x: 5 },
      bounds: { x: 845, y: 0, width: 70, height: 30 },
    },
    bar.cx,
  );
  bar.find(toolbar, "action-a").handlers["on_mouse_up:left"]({}, bar.cx);
  assert.deepEqual(
    plain(bar.tabs.toolbar().visible).map((entry) => entry.id),
    ["b", "a"],
  );
  assert.equal(bar.calls.length, 0);
});

test("overflow menu uses compact native menu styling and no instructional header", () => {
  const h = harness({ mode: "overflow", buttons: [] });
  const el = h.tabs.render(h.cx);
  assert.equal(el.attrs.w[0], 240);
  assert.equal(el.attrs.h[0], 42);
  assert.equal(el.kids.length, 1);
  const empty = h.find(el, "actions-menu-list").kids[0];
  assert.equal(empty.kids[0], "No hidden actions");
  assert.equal(empty.attrs.text_size[0], 12.8);
});

test("overflow anchors below and right-aligned with the dots button", () => {
  const h = harness({ buttons: [] });
  const el = h.tabs.render(h.cx);
  h.find(el, "actions-more").handlers["on_mouse_down:left"](
    { bounds: { x: 1000, y: 10, width: 26, height: 26 } },
    h.cx,
  );
  h.find(el, "actions-more").handlers.on_click({}, h.cx);
  assert.deepEqual(plain(h.calls.at(-1).overlay.at), { x: 786, y: 42 });
});

test("sidebar toggle follows the dots, preserves panel selection, and can be configured or disabled", () => {
  const h = harness();
  let el = h.tabs.render(h.cx);
  const controls = h.find(el, "action-toolbar").kids;
  assert.deepEqual(
    controls.slice(-2).map((child) => child.key),
    ["actions-more", "panel-toggle"],
  );
  h.find(el, "panel-toggle").handlers.on_click({}, h.cx);
  assert.deepEqual(plain(h.calls.at(-1)), { name: "layout.toggle", args: { id: "panel" } });
  assert.equal(h.tree.children[0].children[0].active, "files");
  h.tree.children[0].hidden = true;
  el = h.tabs.render(h.cx);
  assert.equal(h.find(el, "panel-toggle").attrs.tooltip[0], "Show sidebar");
  h.config.panelToggle = false;
  assert.equal(h.find(h.tabs.render(h.cx), "panel-toggle"), undefined);
  h.config.panelToggle = "custom-panel";
  h.tree.children.push({ id: "custom-panel", hidden: true });
  h.find(h.tabs.render(h.cx), "panel-toggle").handlers.on_click({}, h.cx);
  assert.equal(h.calls.at(-1).args.id, "custom-panel");
});

test("toolbar arrangements are isolated by layout and toolbar ID", () => {
  const h = harness({ toolbarId: "primary" });
  h.tabs.savePreferences(h.hideToolbarAction({}, "files"));
  h.config.toolbarId = "secondary";
  assert.equal(h.tabs.preferences().hidden.length, 0);
  h.config.toolbarId = "primary";
  assert.deepEqual(plain(h.tabs.preferences().hidden), ["files"]);
  h.data.layout = "different-layout";
  assert.equal(h.tabs.preferences().hidden.length, 0);
});

test("errors become notifications and shipped package has no Factory dependency", () => {
  const h = harness();
  h.tabs.act({ type: "unknown" }, h.cx);
  assert.match(h.calls[0].notify.body, /Unknown/);
  for (const name of ["main.js", "actions.js", "hooks.js", "toolbar.js"])
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, name), "utf8"),
      /factory-tabs|pull-requests|workflow/,
    );
  for (const asset of [
    "close",
    "spinner",
    "file",
    "changes",
    "win-min",
    "win-max",
    "win-restore",
    "win-close",
    "more-vertical",
    "panel-right",
    "pin",
  ])
    assert.ok(fs.existsSync(path.join(root, asset + ".svg")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "mod.json"))).place, "none");
});
