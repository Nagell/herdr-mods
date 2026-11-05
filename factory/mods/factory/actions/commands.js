// What the panel asks for, through the helper. A run starts in a Claude session of its
// own, which becomes the orchestrator by the /factory skill.
import { exec, run as runCommand } from "herdr";
import { workflowLabel } from "../views/workflows.js";

const STARTING_MS = 60000;

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
    this.taskBox.set_value("");
    this.taskBox.focus();
    cx.notify();
  },

  closeStart(cx) {
    this.startFor = null;
    cx.notify();
  },

  // Blocks a second run until this one's record appears, or long enough to say it didn't.
  startRun(workflow, cx) {
    const task = this.taskBox.value().trim();
    if (!task || this.startBlocked(this.current())) return;
    runCommand("tab.new", {
      folder: this.folder(),
      argv: ["claude", ...(workflow.extra_args ?? [])],
      task: `/factory ${workflow.name} ${task}`,
    });
    const starting = { label: workflowLabel(workflow), was: this.current()?.started ?? null };
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
