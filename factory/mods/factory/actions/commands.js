// What the panel asks for, through the helper. A run starts in a Claude session, new or
// already running, which becomes the orchestrator by the /factory skill.
import { agents, exec, hc, panes, run as runCommand } from "herdr";
import { workflowLabel } from "../views/workflows.js";

const STARTING_MS = 60000;
export const NEW_PARENT = "new";
export const parentName = (agent) => agent.tab_name || agent.title || agent.address;

export const commandMethods = {
  act(args, cx, done) {
    if (this.busy) return;
    const folder = this.folder();
    this.busy = true;
    this.confirm = null;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.helper(args, folder);
        done?.();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
        this.reload(cx);
        cx.notify();
      }
    });
  },

  ask(message, label, action, cx) {
    this.confirm = { message, label, action };
    cx.notify();
  },

  // Follow-ups go to the stage's live session, which keeps what it knows. The text
  // isn't logged or shown afterwards: the sidebar never shows a prompt.
  openFollowUp(stage, cx) {
    this.followUp = stage.id;
    this.editor.set_value("");
    this.editor.focus();
    cx.notify();
  },

  closeFollowUp(cx) {
    this.followUp = null;
    cx.notify();
  },

  sendFollowUp(stage, cx) {
    const task = this.editor.value().trim();
    if (!task) return;
    this.act(["followup", stage.id, task], cx, () => {
      this.followUp = null;
      this.editor.set_value("");
    });
  },

  openStart(workflow, cx) {
    this.startFor = workflow.name;
    this.startParent = NEW_PARENT;
    this.taskBox.set_value("");
    this.taskBox.focus();
    cx.notify();
  },

  closeStart(cx) {
    this.startFor = null;
    cx.notify();
  },

  // Blocks a second run until this one's record appears, or long enough to say it didn't.
  // Claude sessions that could run this: the run's record is written where the session
  // is, so it has to be in the folder on show, and a stage can't also be its own parent.
  parentChoices() {
    const space = this.space()?.id;
    const stages = new Set((this.current()?.stages ?? []).map((s) => s.terminal));
    const here = new Set(panes().filter((p) => p.cwd === this.folder()).map((p) => p.pane));
    return agents().filter(
      (a) =>
        a.space === space &&
        a.program?.key === "claude" &&
        here.has(a.pane) &&
        !stages.has(a.address),
    );
  },

  // Someone may have closed the chosen session since, which goes back to a new one.
  startParentAgent() {
    return this.parentChoices().find((a) => a.address === this.startParent) ?? null;
  },

  startRun(workflow, cx) {
    const task = this.taskBox.value().trim();
    if (!task || this.sendingStart || this.startBlocked(this.current())) return;
    const command = `/factory ${workflow.name} ${task}`;
    const parent = this.startParentAgent();
    if (!parent) {
      runCommand("tab.new", {
        folder: this.folder(),
        argv: ["claude", ...(workflow.extra_args ?? [])],
        task: command,
      });
      return this.startedRun(workflow, "a new tab", cx);
    }
    this.sendingStart = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await hc(["send", parent.address, command]);
        if (result.code !== 0) throw new Error(result.stderr?.trim() || "Could not reach that session.");
        this.startedRun(workflow, parentName(parent), cx);
      } catch (e) {
        this.error = e.message; // The box stays open, so the task isn't lost.
      } finally {
        this.sendingStart = false;
        cx.notify();
      }
    });
  },

  startedRun(workflow, where, cx) {
    const starting = {
      label: workflowLabel(workflow),
      where,
      was: this.current()?.started ?? null,
    };
    this.starting = starting;
    this.startFor = null;
    this.taskBox.set_value("");
    this.showTab("run", cx);
    cx.timer.after(STARTING_MS, (cx) => {
      if (this.starting === starting) this.starting = null;
      cx.notify();
    });
  },

  // The folder of a workflow file, with the templates beside it for the base one.
  openFolder(file, cx) {
    const folder = file.replace(/\/[^/]*$/, "");
    cx.spawn(async (cx) => {
      try {
        const result = await exec("open", [folder], {});
        if (result.code !== 0) throw new Error(result.stderr?.trim() || `Could not open ${folder}`);
      } catch (e) {
        this.error = e.message;
        cx.notify();
      }
    });
  },

  // The last run starts open when nothing is going, and an older one starts shut.
  runIsOpen(run) {
    return this.openRuns[run.archive ?? "current"] ?? !run.archive;
  },

  toggleRun(run, cx) {
    this.openRuns[run.archive ?? "current"] = !this.runIsOpen(run);
    cx.notify();
  },

  toggleStage(stage, run, cx) {
    const key = this.stageOpenKey(run, stage);
    if (!this.openStages.delete(key)) this.openStages.add(key);
    this.loadResults(cx);
    cx.notify();
  },

  toggleGroup(key, cx) {
    if (!this.closedGroups.delete(key)) this.closedGroups.add(key);
    localStorage.setItem("closed-groups", JSON.stringify([...this.closedGroups]));
    cx.notify();
  },

  showTab(tab, cx) {
    this.tab = tab;
    localStorage.setItem("tab", tab);
    if (tab === "workflows") this.loadWorkflows(cx);
    cx.notify();
  },
};
