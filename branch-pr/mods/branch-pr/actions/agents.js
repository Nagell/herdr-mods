// Handing work to the agents: who is on this PR, and what to send them.
import { h_flex } from "gpui-base";
import { agents, panes, hc, run } from "herdr";
import { agentsOnPR, commentMessage, fixCheckMessage, unresolvedMessage } from "../github/model.js";
import { SmallButton, MenuTrigger } from "../views/ui.js";

export const agentName = (agent) => agent?.tab_name || agent?.title || agent?.address || "agent";

export const agentMethods = {
  prAgents() {
    if (!this.pr) return [];
    return agentsOnPR({
      agents: agents(),
      panes: panes(),
      pr: this.pr,
      worktrees: this.currentWorktrees(),
      space: this.sp?.id,
    });
  },

  // Those on the PR first, then the rest of this space, who may well be free.
  agentChoices() {
    const on = this.prAgents();
    const others = agents().filter(
      (a) => a.space === this.sp?.id && !on.some((b) => b.address === a.address),
    );
    return [...on, ...others];
  },

  focusAgent(agent) {
    run("agent.focus", { terminal: agent.address });
  },

  // A button that sends to the likeliest agent, with a chooser when there's a
  // choice. `send(agent, cx)` does the work.
  agentButton({ id, label, icon, send }) {
    const choices = this.agentChoices();
    const [first, ...rest] = choices;
    const button = SmallButton({
      id,
      icon,
      label: first ? label : `${label} (no agent)`,
      disabled: !first || this.mutating,
      onClick: (cx) => send(first, cx),
    });
    if (!rest.length) return button;
    const chooser = this.chooser({
      id: `${id}-agents`,
      accessibilityLabel: `${label}: choose an agent`,
      width: 240,
      trigger: MenuTrigger({ id: `${id}-agents-trigger`, label: "Choose an agent" }),
      choices: choices.map((a) => ({ id: a.address, label: agentName(a), detail: a.address })),
      value: first.address,
      onChoose: (address, cx) =>
        send(
          choices.find((a) => a.address === address),
          cx,
        ),
    });
    // A click on the chooser shouldn't also count as a click on the row around it.
    return h_flex()
      .id(`${id}-group`)
      .flex_none()
      .items_center()
      .on_click((_e, cx) => cx.stop_propagation())
      .child(button.rounded_r(0).border_r(0))
      .child(chooser);
  },

  // Delivery goes through `hc`, which reaches a busy agent's session too.
  deliver(agent, message, cx, done) {
    if (!agent || this.mutating) return;
    const key = this.spaceKey;
    this.mutating = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await hc(["send", agent.address, message]);
        if (result.code !== 0) throw new Error(result.stderr || "Agent delivery failed");
        if (key === this.spaceKey) {
          this.notice = `Sent to ${agentName(agent)}.`;
          done?.();
        }
      } catch (e) {
        if (key === this.spaceKey) this.error = e.message;
      } finally {
        this.mutating = false;
        cx.notify();
      }
    });
  },

  fixCheck(check, agent, cx) {
    this.deliver(agent, fixCheckMessage(this.pr, this.pr.repository, check), cx);
  },

  sendUnresolved(agent, cx) {
    this.deliver(agent, unresolvedMessage(this.pr), cx);
  },

  sendAgent(cx) {
    const composer = this.composer;
    const agent = agents().find((a) => a.address === this.target);
    const draft = this.draftKey;
    const message = commentMessage(this.pr, this.pr.repository, composer, this.editor.value());
    this.deliver(agent, message, cx, () => {
      if (this.composer !== composer) return;
      localStorage.removeItem(draft);
      this.composer = null;
      this.draftKey = null;
    });
  },
};
