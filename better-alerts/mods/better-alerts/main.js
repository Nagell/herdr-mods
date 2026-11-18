// Better Alerts: a system notification when an agent needs you, or finishes while you aren't
// looking at it. Clicking one opens that agent and brings Herdr forward. Linux only: it hands
// the notification to notify-send. It draws nothing, so a layout runs it as an empty floating
// block, and it never runs a program from render.
import { View, div } from "gpui-kit";
import { agents, exec, focused, terminals, window } from "herdr";
import { loadSettings } from "./settings.js";

// Preferences a person may change in the installed mod.json under `settings`.
const DEFAULT_SETTINGS = { alerts: { blocked: true, done: true } };

const WORDS = { blocked: "needs you", done: "finished" };
const BUSY = new Set(["working", "blocked"]);
const CHECK_MS = 500;

// Detached, with its output closed, so exec answers at once and a click still works after
// exec's 30-second limit.
const DETACH = `setsid -f sh -c "$1" sh "$2" "$3" "$4" >/dev/null 2>&1 </dev/null`;

// $1 the title, $2 the body, $3 the agent.focus arguments. Hyprland 0.56's Lua config takes
// only the first focus form, older Hyprland only the second.
const SCRIPT = `
action=$(notify-send -a Herdr -i herdr-app -A default=Open -- "$1" "$2")
[ "$action" = default ] || exit 0
herdr-app do agent.focus "$3"
command -v hyprctl >/dev/null || exit 0
hyprctl dispatch 'hl.dsp.focus({ window = "class:^(herdr-app)$" })' >/dev/null 2>&1 ||
  hyprctl dispatch focuswindow 'class:^(herdr-app)$' >/dev/null 2>&1
`;

// You're looking at an agent when Herdr is the active window and its tab is the shown one.
function looking(agent) {
  if (!window()?.active) return false;
  return focused()?.tab === agent.tab;
}

function agentName(agent) {
  return agent.program?.name || agent.app || agent.title || agent.address;
}

class BetterAlerts extends View {
  init(_props, cx) {
    this.settings = DEFAULT_SETTINGS;
    this.seen = new Map(agents().map((a) => [a.address, a.status]));
    this.warned = false;
    if (window()?.platform !== "linux") return;
    cx.spawn(async (cx) => {
      const { settings, problems } = await loadSettings("better-alerts", DEFAULT_SETTINGS);
      this.settings = settings;
      for (const problem of problems) console.warn(`better-alerts mod.json settings: ${problem}`);
      cx.notify();
    });
    cx.timer.every(CHECK_MS, () => this.check());
  }

  // Posts for each agent whose status changed since the last look, including a new agent's
  // first one. Agents already there when it starts count as seen, and a sub-agent posts
  // nothing, since its parent speaks for it.
  check() {
    const live = new Set();
    const subAgents = new Set(terminals().filter((t) => t?.parent).map((t) => t.address));
    for (const a of agents()) {
      live.add(a.address);
      const before = this.seen.get(a.address);
      this.seen.set(a.address, a.status);
      if (before === a.status || subAgents.has(a.address)) continue;
      // Only needs-you and finished have a setting, so this also skips every other status.
      if (!this.settings.alerts[a.status]) continue;
      if (a.status === "done" && (!BUSY.has(before) || looking(a))) continue;
      this.post(a);
    }
    for (const address of this.seen.keys()) if (!live.has(address)) this.seen.delete(address);
  }

  post(agent) {
    const title = `${agentName(agent)} ${WORDS[agent.status]}`;
    const body = `${agent.space_name} / ${agent.tab_name}`;
    const target = JSON.stringify({ terminal: agent.address });
    exec("sh", ["-c", DETACH, "sh", SCRIPT, title, body, target]).catch((error) => {
      if (this.warned) return;
      this.warned = true;
      console.warn(`better-alerts: couldn't post a notification: ${error}`);
    });
  }

  render() {
    return div();
  }
}

export default BetterAlerts;
