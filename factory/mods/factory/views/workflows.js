// The Workflows tab: every workflow this repo can run, base and its own, and starting one.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, theme } from "herdr";
import { going, stageDetails, titleCase } from "../run/model.js";
import {
  TEXT,
  Button,
  ControlButton,
  GroupHeader,
  Icon,
  IconButton,
  Message,
  Notice,
  TextBox,
} from "./ui.js";

const SOURCES = [
  { id: "repo", label: "Repo" },
  { id: "base", label: "Base" },
];

// A base workflow the repo also names is run as base:<name>. Its group already says so.
export const workflowLabel = (workflow) => titleCase(workflow.name.replace(/^base:/, ""));

export const workflowMethods = {
  // One run at a time: starting another would end the sessions of the one going.
  startBlocked(run) {
    if (going(run)) return "A run is going here. Stop it or let it finish to start another.";
    if (this.starting) return "A run is starting in a new tab.";
    if (this.missing.includes("claude")) return "Claude isn't on your PATH.";
    return null;
  },

  // Who does what, in order. A stage's model, effort and role are in its tooltip.
  stageChain(workflow) {
    const t = theme();
    const chain = h_flex().gap(4).flex_wrap().items_center().min_w(0);
    workflow.stages.forEach((stage, i) => {
      if (i) chain.child(Icon("chevron-right", 10).text_color(t.dim));
      const loop = stage.loop
        ? `Checks ${titleCase(stage.loop.with)}'s work, up to ${stage.loop.max} rounds`
        : "";
      chain.child(
        h_flex()
          .id(`factory-chain-${workflow.name}-${stage.id}`)
          .flex_none()
          .gap(3)
          .items_center()
          .text_size(TEXT.caption)
          .text_color(t.muted)
          .tooltip([stageDetails(stage), loop].filter(Boolean).join(" · ") || titleCase(stage.id))
          .child(titleCase(stage.id))
          .when(Boolean(loop), (el) => el.child(Icon("refresh", 10).text_color(t.dim))),
      );
    });
    return chain;
  },

  startBox(workflow, run) {
    const t = theme();
    const closes = (run?.stages ?? []).some((s) => this.alive(s.terminal));
    return v_flex()
      .id(`factory-start-${workflow.name}`)
      .flex_none()
      .min_w(0)
      .pt(4)
      .gap(8)
      .child(TextBox({ id: "factory-task-input", state: this.taskBox, label: "Task" }))
      .when(closes, (el) =>
        el.child(
          div()
            .whitespace_normal()
            .text_size(TEXT.caption)
            .text_color(t.dim)
            .child("The last run's sessions end when this starts, apart from any set to reuse."),
        ),
      )
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(
            Button({
              id: "factory-start-cancel",
              label: "Close",
              onClick: (cx) => this.closeStart(cx),
            }),
          )
          .child(
            Button({
              id: "factory-start-send",
              label: "Start run",
              primary: true,
              disabled: Boolean(this.startBlocked(run)) || !this.taskBox.value().trim(),
              onClick: (cx) => this.startRun(workflow, cx),
            }),
          ),
      );
  },

  // Text in one tight column, with Run beside all of it rather than above the description.
  workflowRow(workflow, run, blocked) {
    const t = theme();
    return v_flex()
      .id(`factory-workflow-${workflow.name}`)
      .flex_none()
      .min_w(0)
      .px(8)
      .py(9)
      .gap(8)
      .child(
        h_flex()
          .gap(12)
          .min_w(0)
          .items_start()
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(1)
              .child(div().truncate().font_medium().child(workflowLabel(workflow)))
              .when(Boolean(workflow.description), (el) =>
                el.child(
                  div()
                    .whitespace_normal()
                    .text_size(TEXT.small)
                    .text_color(t.muted)
                    .child(workflow.description),
                ),
              )
              .child(div().pt(2).child(this.stageChain(workflow))),
          )
          .child(
            ControlButton({
              id: `factory-run-${workflow.name}`,
              icon: "play",
              label: "Run",
              tooltip: blocked ?? `Run ${workflowLabel(workflow)}`,
              disabled: Boolean(blocked),
              onClick: (cx) => this.openStart(workflow, cx),
            }),
          ),
      )
      .when(this.startFor === workflow.name, (el) => el.child(this.startBox(workflow, run)));
  },

  workflowsView(root, run) {
    const workflows = this.workflows ?? [];
    const blocked = this.startBlocked(run);
    const body = v_flex().id("factory-workflows").flex_1().min_h(0).overflow_y_scrollbar().p(6);
    if (blocked) body.child(Notice(blocked).mb(6));
    if (this.workflows && !workflows.length)
      body.child(
        Message(`No workflows. Add one to ${home()}/.config/herdr-mods/factory/workflow.json.`),
      );
    // A notice above is something to set the first group apart from too.
    let divided = Boolean(blocked);
    for (const source of SOURCES) {
      const group = workflows.filter((w) => w.source === source.id);
      if (!group.length) continue;
      const key = `workflows:${source.id}`;
      const shut = this.closedGroups.has(key);
      body.child(
        GroupHeader({
          id: `factory-workflows-${source.id}`,
          label: source.label,
          count: group.length,
          collapsed: shut,
          divided,
          onClick: (cx) => this.toggleGroup(key, cx),
          action: IconButton({
            id: `factory-folder-${source.id}`,
            icon: "folder",
            label: `Open the ${source.id} workflows folder`,
            small: true,
            onClick: (cx) => this.openFolder(group[0].path, cx),
          }),
        }),
      );
      if (!shut) group.forEach((w) => body.child(this.workflowRow(w, run, blocked)));
      divided = true;
    }
    return root.child(body);
  },
};
