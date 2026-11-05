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
      .replace(/^export \{[^}]*\};?\n/gm, "")
      .replace(/^export default \w+;\n/m, "globalThis.Tabs = Tabs;\n")
      .replace(/^export /gm, "");
  vm.runInContext(
    [
      "settings.js",
      "actions/engine.js",
      "actions/toolbar.js",
      "views/ui.js",
      "views/panel-memory.js",
      "views/arrangement.js",
      "views/drags.js",
      "views/menu.js",
      "views/tab-bar.js",
      "main.js",
    ]
      .map(load)
      .join("\n") +
      "\nglobalThis.api = {execute, buttons, isActive, find, toolbarPartition, toolbarPreferences, hideToolbarAction, placeToolbarAction, tabMoveIndex};",
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
test("commands dispatch, and other action types are refused", () => {
  const h = harness();
  h.execute({ type: "command", name: "tab.new", args: { name: "Example" } });
  assert.equal(h.calls[0].name, "tab.new");
  assert.throws(() => h.execute({ type: "sequence", actions: [] }), /Unknown/);
  assert.throws(() => h.execute({ type: "overlay", mod: "x" }), /Unknown/);
});

test("the button command runs a button by ID, and ignores unknown ones", () => {
  const h = harness({
    buttons: [{ id: "x", action: { type: "command", name: "tab.new" } }],
  });
  h.tabs.command("button:missing");
  assert.equal(h.calls.length, 0);
  h.tabs.command("button:x");
  assert.equal(h.calls[0].name, "tab.new");
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
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
  assert.equal(h.calls.at(-1).name, "tab.rename");
  const start = { position: { x: 20, y: 15 }, click_count: 1 };
  const drop = {
    position: { x: 180, y: 15 },
    local_position: { x: 80, y: 15 },
    bounds: { x: 100, y: 0, width: 100, height: 30 },
  };
  h.find(el, "tab-t1").handlers["on_mouse_down:left"](start, h.cx);
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
  h.find(el, "tab-t2").handlers.on_mouse_move(drop, h.cx);
  assert.ok(h.find(h.tabs.render(h.cx), "drag-preview"));
  h.find(el, "tab-t2").handlers["on_mouse_up:left"](drop, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.move");
  h.tabs.ignoreClickUntil = 0;
  h.find(el, "close-t1").handlers.on_click({}, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.close");
  h.find(el, "tab-t2").handlers["on_mouse_down:left"]({}, h.cx);
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
  h.find(el, "tab-t2").handlers["on_mouse_up:left"]({}, h.cx);
  assert.equal(h.calls.at(-1).name, "tab.select");
  h.find(el, "tab-t2").handlers["on_mouse_down:right"]({}, h.cx);
  assert.equal(h.calls.at(-1).overlay.mod, "menu");
});
test("overflow uses this mod and includes hidden-toolbar actions ", () => {
  const h = harness({
    buttons: ["a", "b", "c"].map((id) => ({
      id,
      label: id,
      action: { type: "command", name: "tab.new" },
    })),
  });
  h.tabs.width = 450; // Room for one button.
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
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
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
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
  h.find(el, "better-tabs-root").handlers.on_hover(false, h.cx);
  h.find(el, "tab-t2").handlers["on_mouse_up:left"]({}, h.cx);
  assert.equal(h.calls.length, 0);
});

test("dropping a terminal tab on a toolbar action cancels without activating it", () => {
  const h = harness();
  const el = h.tabs.render(h.cx);
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ position: { x: 20, y: 15 } }, h.cx);
  if (h.tabs.tabDrag) h.tabs.tabDrag.pressedAt = 0;
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
  h.data["better-tabs.action-drag"].pressedAt = 0;
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

test("hidden actions sort alphabetically and can be pinned", () => {
  const h = harness();
  const entries = [
    { id: "z", label: "Zulu" },
    { id: "b", label: "beta" },
    { id: "a", label: "Alpha" },
  ];
  let saved = h.hideToolbarAction(h.hideToolbarAction({}, "z"), "b");
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
  assert.deepEqual(plain(h.toolbarPreferences({ hidden: ["x", "x", null], pinned: ["old"] })), {
    hidden: ["x"],
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
  assert.equal(h.tabs.preferences().hidden.includes("z"), false);
  assert.equal(h.tabs.preferences().order[0], "z");
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

test("toolbar arrangements are kept per layout", () => {
  const h = harness();
  h.tabs.savePreferences(h.hideToolbarAction({}, "files"));
  assert.deepEqual(plain(h.tabs.preferences().hidden), ["files"]);
  h.data.layout = "different-layout";
  assert.equal(h.tabs.preferences().hidden.length, 0);
});

test("errors become notifications and shipped package has no Factory dependency", () => {
  const h = harness();
  h.tabs.act({ type: "unknown" }, h.cx);
  assert.match(h.calls[0].notify.body, /Unknown/);
  for (const name of ["main.js", "actions/engine.js", "actions/toolbar.js"])
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
    "more-vertical",
    "pin",
  ])
    assert.ok(fs.existsSync(path.join(root, `icons/${asset}.svg`)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "mod.json"))).place, "none");
});
test("mod tabs get the icon the mod published, program icons win, unknown mods get none", () => {
  const h = harness({ buttons: [] });
  const paths = [];
  h.context.svg = (p) => {
    paths.push(p);
    return h.context.div();
  };
  h.data["mod-icons"] = { "branch-pr": "mods/branch-pr/pull-request.svg" };
  h.setPanes([{ tab: "t1", mod: "branch-pr" }]);
  h.tabs.render(h.cx);
  assert.ok(paths.includes("mods/branch-pr/pull-request.svg"));
  paths.length = 0;
  h.setPanes([
    { tab: "t1", mod: "unknown" },
    { tab: "t2", program: { icon: "icons/claude.svg", tint: true } },
  ]);
  h.tabs.render(h.cx);
  assert.ok(!paths.some((p) => p.includes("pull-request")));
  assert.ok(paths.includes("icons/claude.svg"));
});

test("the bar grows with wrapped tabs, once per height, on the right layout node", () => {
  const h = harness();
  h.tabs.fitHeight({ width: 900, height: 29 });
  h.tabs.fitHeight({ width: 900, height: 64 });
  h.tabs.fitHeight({ width: 900, height: 64 });
  const resizes = h.calls.filter((c) => c.name === "layout.resize");
  assert.deepEqual(plain(resizes.map((c) => c.args.px)), [42, 77]);
  assert.equal(resizes[0].args.id, "tabs");
});

test("a quick press on a toolbar action does not drag, even if the pointer slips", () => {
  const h = harness({
    buttons: [{ id: "a", label: "A", action: { type: "command", name: "app.palette" } }],
  });
  const el = h.tabs.render(h.cx);
  const action = h.find(el, "action-a");
  const bounds = { x: 780, y: 0, width: 60, height: 40 };
  action.handlers["on_mouse_down:left"]({ position: { x: 800, y: 15 } }, h.cx);
  action.handlers.on_mouse_move(
    { position: { x: 830, y: 15 }, bounds, local_position: { x: 50 } },
    h.cx,
  );
  assert.equal(h.data["better-tabs.action-drag"].active, false);
  action.handlers["on_mouse_up:left"]({}, h.cx);
  action.handlers.on_click({}, h.cx);
  assert.equal(h.calls.at(-1).name, "app.palette");
});

test("a click on a toolbar action ends its press, even if no release arrives", () => {
  const h = harness({
    buttons: [{ id: "a", label: "A", action: { type: "command", name: "app.palette" } }],
  });
  const el = h.tabs.render(h.cx);
  const action = h.find(el, "action-a");
  action.handlers["on_mouse_down:left"]({ position: { x: 800, y: 15 } }, h.cx);
  h.data["better-tabs.action-drag"].pressedAt = 0;
  action.handlers.on_click({}, h.cx);
  assert.equal(h.data["better-tabs.action-drag"], null);
  assert.equal(h.calls.at(-1).name, "app.palette");
  h.find(el, "better-tabs-root").handlers.on_mouse_move({ position: { x: 950, y: 15 } }, h.cx);
  assert.equal(h.find(h.tabs.render(h.cx), "drag-preview"), undefined);
});

test("a quick press does not drag, even if the pointer slips, and still selects the tab", () => {
  const h = harness({ buttons: [] });
  const el = h.tabs.render(h.cx);
  const slip = {
    position: { x: 60, y: 15 },
    local_position: { x: 60 },
    bounds: { x: 0, y: 0, width: 100, height: 30 },
  };
  h.find(el, "tab-t1").handlers["on_mouse_down:left"]({ position: { x: 20, y: 15 } }, h.cx);
  h.find(el, "tab-t1").handlers.on_mouse_move(slip, h.cx);
  assert.equal(h.tabs.tabDrag.active, false);
  assert.equal(h.find(h.tabs.render(h.cx), "drag-preview"), undefined);
  h.tabs.tabDrag.pressedAt = 0; // the same press, held past the delay
  h.find(el, "tab-t1").handlers.on_mouse_move({ ...slip, position: { x: 28, y: 15 } }, h.cx);
  assert.equal(h.tabs.tabDrag.active, false); // too short a move, even after the delay
  h.find(el, "tab-t1").handlers.on_mouse_move(slip, h.cx);
  assert.equal(h.tabs.tabDrag.active, true);
  h.tabs.tabDrag = null;
  h.find(el, "tab-t2").handlers["on_mouse_down:left"]({ position: { x: 120, y: 15 } }, h.cx);
  h.find(el, "tab-t2").handlers.on_mouse_move({ ...slip, position: { x: 150, y: 15 } }, h.cx);
  h.find(el, "tab-t2").handlers["on_mouse_up:left"]({ position: { x: 150, y: 15 } }, h.cx);
  assert.deepEqual(plain(h.calls), [{ name: "tab.select", args: { id: "t2" } }]);
});
