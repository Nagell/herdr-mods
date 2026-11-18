// Better Alerts against stand-ins for Herdr. Nothing here posts a real notification.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../mods/better-alerts");

function harness({ platform = "linux", settings = null, exec } = {}) {
  const live = { agents: [], terminals: [], focused: null, active: true };
  const ran = [], timers = [], warned = [];
  const cx = { notify() {}, spawn(fn) { fn(cx); }, timer: { every: (ms, fn) => timers.push({ ms, fn }) } };
  const context = {
    View: class {},
    div: () => ({ kind: "div" }),
    agents: () => live.agents,
    terminals: () => live.terminals,
    focused: () => live.focused,
    window: () => ({ platform, active: live.active }),
    appHome: () => "/app",
    readTextFile: async () => (settings ? JSON.stringify({ settings }) : null),
    exec: exec ?? (async (bin, args) => (ran.push([bin, ...args]), { code: 0, stdout: "", stderr: "" })),
    console: { ...console, warn: (m) => warned.push(m) },
  };
  vm.createContext(context);
  const source = ["settings.js", "main.js"]
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
    .join("\n")
    .replace(/^import\s+[\s\S]*?;$/gm, "")
    .replace(/^export default (\w+);?$/m, "globalThis.Mod = $1;")
    .replace(/^export default class (\w+)/m, "globalThis.Mod = class $1")
    .replace(/^export /gm, "");
  vm.runInContext(source, context);
  const agent = (address, status, over = {}) => ({
    address, status, tab: `tab-${address}`, space_name: "lantern-app", tab_name: "Fix the login form",
    program: { name: "Claude Code" }, ...over,
  });
  const start = () => {
    const mod = new context.Mod();
    mod.init({}, cx);
    return mod;
  };
  const tick = () => timers.forEach((t) => t.fn(cx));
  // The notifications posted: [title, body, target] from the detached script's arguments.
  const posted = () => ran.map((r) => r.slice(-3)).map(([title, body, target]) => ({ title, body, target: JSON.parse(target) }));
  return { live, ran, timers, warned, agent, start, tick, posted, cx };
}
const settle = () => new Promise((done) => setImmediate(done));

test("an agent that needs you posts a notification, once", async () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  h.tick();
  h.tick();
  assert.deepEqual(h.posted(), [{ title: "Claude Code needs you", body: "lantern-app / Fix the login form", target: { terminal: "t1" } }]);
});

test("a finished agent posts only after it was busy, and only when you aren't looking at it", () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "idle"), h.agent("t3", "working")];
  h.live.focused = { tab: "tab-t3" };
  h.start();
  h.live.agents = [h.agent("t1", "done"), h.agent("t2", "done"), h.agent("t3", "done")];
  h.tick();
  assert.deepEqual(h.posted().map((p) => p.title + " " + p.target.terminal), ["Claude Code finished t1"]);
  // Looking at its tab but with Herdr in the background counts as not looking.
  h.live.active = false;
  h.live.agents = [h.agent("t3", "working")];
  h.tick();
  h.live.agents = [h.agent("t3", "done")];
  h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t1", "t3"]);
});

test("agents already in a state when it starts, sub-agents and agents that left post nothing", () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "blocked")];
  h.live.terminals = [{ address: "t9", parent: "t1" }];
  h.start();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t9", "working")];
  h.tick();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t9", "blocked")];
  h.tick();
  assert.deepEqual(h.posted(), []);
  // An agent that leaves and comes back starts fresh.
  h.live.agents = [];
  h.tick();
  h.live.agents = [h.agent("t1", "blocked")];
  h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t1"]);
});

test("the name is the program's, else the app's, the title's, or the address", () => {
  const h = harness();
  const kinds = [
    h.agent("a", "working", { program: { name: "Codex" } }),
    h.agent("b", "working", { program: null, app: "pi" }),
    h.agent("c", "working", { program: null, app: null, title: "Review" }),
    h.agent("d", "working", { program: null, app: null, title: null }),
  ];
  h.live.agents = kinds;
  h.start();
  h.live.agents = kinds.map((a) => ({ ...a, status: "blocked" }));
  h.tick();
  assert.deepEqual(h.posted().map((p) => p.title), ["Codex needs you", "pi needs you", "Review needs you", "d needs you"]);
});

test("the notification is handed to notify-send in a detached shell, and a click opens the agent", () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  h.tick();
  const [bin, flag, detach, , script] = h.ran[0];
  assert.equal(bin, "sh");
  assert.equal(flag, "-c");
  assert.match(detach, /^setsid -f sh -c "\$1" sh "\$2" "\$3" "\$4" >\/dev\/null 2>&1 <\/dev\/null$/);
  assert.match(script, /notify-send -a Herdr -i herdr-app -A default=Open -- "\$1" "\$2"/);
  assert.match(script, /herdr-app do agent\.focus "\$3"/);
  assert.match(script, /hl\.dsp\.focus\(\{ window = "class:\^\(herdr-app\)\$" \}\)'[^\n]*\|\|\n\s*hyprctl dispatch focuswindow 'class:\^\(herdr-app\)\$'/);
});

test("each kind of alert can be turned off in the settings", async () => {
  const h = harness({ settings: { alerts: { done: false } } });
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "working")];
  h.start();
  await settle();
  h.live.agents = [h.agent("t1", "done"), h.agent("t2", "blocked")];
  h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t2"]);
  const off = harness({ settings: { alerts: { blocked: false } } });
  off.live.agents = [off.agent("t1", "working")];
  off.start();
  await settle();
  off.live.agents = [off.agent("t1", "blocked")];
  off.tick();
  assert.deepEqual(off.posted(), []);
});

test("on macOS and Windows it does nothing, and it draws nothing", () => {
  for (const platform of ["macos", "windows"]) {
    const h = harness({ platform });
    h.live.agents = [h.agent("t1", "working")];
    const mod = h.start();
    assert.equal(h.timers.length, 0);
    assert.deepEqual(mod.render(), { kind: "div" });
  }
  const linux = harness();
  linux.start();
  assert.deepEqual(linux.timers.map((t) => t.ms), [500]);
});

test("a notification that can't be handed over is reported once, not on every alert", async () => {
  const h = harness({ exec: async () => { throw new Error("exec: sh not found"); } });
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t2", "blocked")];
  h.tick();
  await settle();
  assert.deepEqual(h.warned, ["better-alerts: couldn't post a notification: Error: exec: sh not found"]);
});

test("the mod ships its manifest, schema and settings, and docks nowhere", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "mod.json"), "utf8"));
  assert.equal(manifest.place, "none");
  assert.equal(manifest.title, "Better Alerts");
  assert.equal(manifest.$schema, "./mod.schema.json");
  const schema = JSON.parse(fs.readFileSync(path.join(root, "mod.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.properties.settings.properties.alerts.properties), ["blocked", "done"]);
});
