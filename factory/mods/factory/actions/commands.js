// What the panel asks for, all through the helper. It doesn't start runs: the skill does.
import { exec, home } from "herdr";

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

  openConfig(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.helper(["init"]);
        const result = await exec("open", [`${home()}/.config/herdr-mods/factory`], {});
        if (result.code !== 0)
          throw new Error(result.stderr?.trim() || "Could not open the folder");
      } catch (e) {
        this.error = e.message;
        cx.notify();
      }
    });
  },

  toggleStage(stage, cx) {
    if (!this.openStages.delete(stage.id)) this.openStages.add(stage.id);
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
    cx.notify();
  },
};
