// Factory: a sidebar for a staged agent run, recorded in the active space's
// .herdr-factory/run.json. A Claude session running the /factory skill is the
// orchestrator, and the stages are sessions it starts. The class is built from:
//   run/reads.js          reading the run, workflows and results
//   actions/commands.js   starting, stopping, rerunning and following up
//   actions/menus.js      the popup menus
//   views/run.js, workflows.js, empty.js, events.js   the drawing
// run/model.js says what a run's record means; views/ui.js holds every look.
import { View } from "gpui-kit";
import { h_flex, TextareaState } from "gpui-base";
import { layout, nextCommand, spaces } from "herdr";
import { loadSettings, duration } from "./settings.js";
import { panelShown } from "./run/model.js";
import { readMethods } from "./run/reads.js";
import { commandMethods } from "./actions/commands.js";
import { menuMethods } from "./actions/menus.js";
import { runMethods } from "./views/run.js";
import { emptyMethods } from "./views/empty.js";
import { workflowMethods } from "./views/workflows.js";
import { eventMethods } from "./views/events.js";
import {
  HeaderTab,
  IconButton,
  Message,
  Notice,
  Panel,
  PanelHeader,
  SPIN_MS,
} from "./views/ui.js";

const POLL_MS = 1500;
const MIN_POLL_MS = 500;
const DEFAULT_SETTINGS = { refresh: { run: "1500ms" } };

const stored = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

class Factory extends View {
  init(_props, cx) {
    this.runs = {}; // folder -> its parsed run.json, null when there is none
    this.raw = {};
    this.results = {}; // "<folder>:<run start>:<stage>-<attempt>" -> its parsed result file
    this.histories = {}; // folder -> its past runs, newest first
    this.openRuns = {}; // run -> open or shut, once the person has said
    this.tab = ["events", "workflows"].includes(localStorage.getItem("tab"))
      ? localStorage.getItem("tab")
      : "run";
    this.openStages = new Set();
    this.closedGroups = new Set(stored("closed-groups") ?? []);
    this.workflows = null;
    this.missing = [];
    this.eventsShown = "all";
    this.confirm = null; // { message, label, action }
    this.followUp = null; // the stage whose box is open
    this.startFor = null; // the workflow whose box is open
    this.starting = null; // { label, was }: a run asked for, whose record hasn't appeared
    this.busy = false;
    this.error = null;
    this.menuFocus = cx.focus_handle();
    this.eventsTrigger = cx.focus_handle();
    this.editor = TextareaState.new({ placeholder: "What should this stage do next?", rows: 3 });
    this.editor.on("change", (_e, cx) => cx.notify());
    this.taskBox = TextareaState.new({ placeholder: "What should this run do?", rows: 3 });
    this.taskBox.on("change", (_e, cx) => cx.notify());
    this.shownFolder = this.folder();
    this.reload(cx);
    this.loadWorkflows(cx);
    cx.spawn(async (cx) => {
      const { settings, problems } = await loadSettings("factory", DEFAULT_SETTINGS);
      if (problems.length) this.error = problems.join(" ");
      const every = Math.max(MIN_POLL_MS, duration(settings.refresh.run, POLL_MS));
      cx.timer.every(every, (cx) => this.tick(cx));
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "refresh") this.refreshNow(cx);
      }
    });
  }

  space() {
    return spaces().find((s) => s.active);
  }

  folder() {
    return this.space()?.folder ?? null;
  }

  current() {
    return this.runs[this.folder()] ?? null;
  }

  // A hidden panel reads nothing, and catches up when it's shown.
  tick(cx) {
    if (!panelShown(layout(), "factory")) return;
    const folder = this.folder();
    if (folder !== this.shownFolder) {
      this.shownFolder = folder;
      this.confirm = null;
      this.followUp = null;
      this.startFor = null;
      this.starting = null;
      this.error = null;
      this.openStages.clear();
      this.openRuns = {};
      this.loadWorkflows(cx);
      cx.notify();
    }
    this.reload(cx);
  }

  // The helper usually answers at once, so the icon always makes a full turn to be seen.
  refreshNow(cx) {
    this.reload(cx);
    this.loadHistory(cx);
    this.loadWorkflows(cx);
    this.spinning = true;
    cx.notify();
    cx.timer.after(SPIN_MS, (cx) => {
      this.spinning = false;
      cx.notify();
    });
  }

  header(run) {
    return PanelHeader()
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .ml(-8) // Lines the pills up with the list rows below.
          .gap(4)
          .items_center()
          .role("tab_list")
          .child(
            HeaderTab({
              id: "factory-tab-run",
              label: "Runs",
              count: (run?.stages?.length ? 1 : 0) + this.history().length,
              active: this.tab === "run",
              onClick: (cx) => this.showTab("run", cx),
            }),
          )
          .child(
            HeaderTab({
              id: "factory-tab-workflows",
              label: "Workflows",
              count: this.workflows?.length ?? 0,
              active: this.tab === "workflows",
              onClick: (cx) => this.showTab("workflows", cx),
            }),
          )
          .child(
            HeaderTab({
              id: "factory-tab-events",
              label: "Events",
              count: run?.events?.length ?? 0,
              active: this.tab === "events",
              onClick: (cx) => this.showTab("events", cx),
            }),
          ),
      )
      .child(
        IconButton({
          id: "factory-refresh",
          icon: "refresh",
          label: "Refresh",
          spinning: Boolean(this.spinning),
          onClick: (cx) => this.refreshNow(cx),
        }),
      );
  }

  render() {
    const run = this.current();
    if (this.starting && (run?.started ?? null) !== this.starting.was) this.starting = null;
    const root = Panel({ id: "factory" }).child(this.header(run));
    const space = this.space();
    if (!space) return root.child(Message("Select a space to see its run."));
    // shortcut: the helper and run file are read on this computer only; run both through `exec {on}` to reach other machines.
    if (space.machine)
      return root.child(
        Message("Runs work on this computer only, and this space is on another machine."),
      );
    if (this.missing.length)
      root.child(
        Message(
          `${this.missing.join(" and ")} ${this.missing.length > 1 ? "aren't" : "isn't"} on your PATH, so stages can't start.`,
          true,
        ),
      );
    if (this.error) root.child(Message(this.error, true));
    if (this.starting)
      root.child(Notice(`Starting ${this.starting.label} in a new tab.`).mx(6).mt(6));
    if (this.tab === "events") this.eventsView(root, run);
    else if (this.tab === "workflows") this.workflowsView(root, run);
    else if (!run?.stages?.length) this.emptyView(root);
    else this.runView(root, run);
    return root;
  }
}

Object.assign(
  Factory.prototype,
  readMethods,
  commandMethods,
  menuMethods,
  runMethods,
  emptyMethods,
  workflowMethods,
  eventMethods,
);

export default Factory;
