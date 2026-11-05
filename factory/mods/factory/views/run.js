// The Run tab: which workflow, how far along, and the tree of who is doing what.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run as runCommand, terminals, theme } from "herdr";
import {
  findingGroups,
  running,
  runStats,
  stageDetails,
  stageLabel,
  stageResult,
  stageStatus,
} from "../run/model.js";
import { dayLabel } from "./days.js";
import {
  TEXT,
  Button,
  Chevron,
  codeFont,
  GroupHeader,
  halfTone,
  Icon,
  IconButton,
  MenuButton,
  Message,
  SPIN_MS,
  Stat,
  TextBox,
  TextButton,
} from "./ui.js";

const STATE_COLORS = { working: "working", done: "done", failed: "blocked" };
const peek = (address) => runCommand("terminal.peek", { terminal: address });

function StatusIcon(status, t) {
  const icon = Icon(status.icon, 15)
    .text_color(t[status.color] ?? t.dim)
    .accessibility_label(status.label);
  return status.icon === "spinner" ? icon.spin(SPIN_MS) : icon;
}

function ProgramIcon(program, t) {
  if (!program?.icon) return Icon("factory", 14).text_color(t.muted);
  return program.tint
    ? svg(program.icon).size(14).flex_none().text_color(t.foreground)
    : image(program.icon).w(14).h(14).flex_none();
}

// A child sits right of a line from its parent, and a line runs on to the next
// sibling however tall this child grows.
function TreeNode(last, content, t) {
  return v_flex()
    .relative()
    .pl(14)
    .min_w(0)
    .when(!last, (el) => el.child(div().absolute().top(0).bottom(0).left(0).w(1).bg(t.border)))
    .child(
      div()
        .absolute()
        .top(0)
        .left(0)
        .w(10)
        .h(15)
        .border_l(1)
        .border_b(1)
        .rounded_bl(6)
        .border_color(t.border),
    )
    .child(content);
}

export const runMethods = {
  terminal(address) {
    return terminals().find((k) => k.address === address) ?? null;
  },

  alive(address) {
    return this.terminal(address)?.state === "live";
  },

  runActions(run) {
    const live = this.alive(run.orchestrator);
    const choices = [
      ...(running(run) ? [{ id: "stop", label: "Stop run" }] : []),
      { id: "folder", label: "Open workflows folder", divided: running(run) },
      ...(live ? [{ id: "close-all", label: "Close Factory and every session" }] : []),
    ];
    const handlers = {
      stop: (cx) =>
        this.ask(
          "Stop the run and end its stage sessions?",
          "Stop run",
          (cx) => this.act(["stop"], cx),
          cx,
        ),
      folder: (cx) => this.openConfig(cx),
      "close-all": (cx) =>
        this.ask(
          "Close Factory and every stage session, and stop the run?",
          "Close all",
          (cx) => this.act(["stop", "--orchestrator"], cx),
          cx,
        ),
    };
    return this.chooser({
      id: "factory-actions",
      accessibilityLabel: "Actions for this run",
      width: 300,
      trigger: MenuButton({ id: "factory-actions-trigger", label: "Actions" }),
      choices,
      onChoose: (id, cx) => handlers[id](cx),
    });
  },

  about(run) {
    const t = theme();
    const COLORS = { danger: t.ansi1, waiting: t.ansi3, good: t.ansi2, none: t.muted };
    const when = run.started ? `${dayLabel(run.started)} ${run.started.slice(11, 16)}` : "";
    const stats = runStats(run);
    const strip = h_flex()
      .id("factory-stats")
      .px(10)
      .py(6)
      .gap(8)
      .flex_wrap()
      .items_center()
      .rounded(6)
      .bg(halfTone(t.raised));
    stats.forEach((stat, i) => {
      if (i) strip.child(div().text_color(t.dim).child("·"));
      strip.child(
        Stat({
          id: `factory-stat-${stat.key}`,
          value: stat.value,
          label: stat.label,
          color: COLORS[stat.tone],
          detail: stat.detail,
        }),
      );
    });
    return v_flex()
      .id("factory-about")
      .flex_none()
      .px(14)
      .py(10)
      .gap(8)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(8)
          .min_w(0)
          .items_center()
          .child(
            div()
              .size(10)
              .flex_none()
              .rounded(5)
              .bg(t[STATE_COLORS[run.state]] ?? t.dim),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .child(
                div()
                  .truncate()
                  .font_medium()
                  .child(run.workflow ?? "Workflow"),
              )
              .child(
                div()
                  .truncate()
                  .text_size(TEXT.caption)
                  .text_color(t.dim)
                  .child([run.state, when].filter(Boolean).join(" · ")),
              ),
          )
          .child(this.runActions(run)),
      )
      .child(strip);
  },

  orchestratorRow(run) {
    const t = theme();
    const session = this.terminal(run.orchestrator);
    const live = session?.state === "live";
    return h_flex()
      .id("factory-orchestrator")
      .h(30)
      .px(4)
      .gap(7)
      .min_w(0)
      .items_center()
      .rounded(6)
      .when(live, (el) =>
        el
          .cursor_pointer()
          .accessibility_label("Open Factory's session")
          .hover((s) => s.bg(t.hover))
          .on_click(() => peek(run.orchestrator)),
      )
      .child(ProgramIcon(session?.program, t))
      .child(div().font_medium().child("Factory"))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(TEXT.caption)
          .text_color(t.dim)
          .child(
            live ? "" : run.state === "done" ? "Session ended" : "Session gone: /factory continue",
          ),
      )
      .when(session?.status === "working", (el) =>
        el.child(StatusIcon({ icon: "spinner", color: "working", label: "Working" }, t)),
      );
  },

  // Helpers a stage started with `hc run`, with their own helpers below them.
  helperNodes(parent, skip) {
    const t = theme();
    const kids = terminals().filter(
      (k) => k.parent === parent && k.state === "live" && !skip.has(k.address),
    );
    return kids.map((k, i) =>
      TreeNode(
        i === kids.length - 1,
        v_flex()
          .min_w(0)
          .child(
            h_flex()
              .id(`factory-helper-${k.address}`)
              .h(26)
              .px(4)
              .gap(6)
              .min_w(0)
              .items_center()
              .rounded(6)
              .text_size(TEXT.small)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click(() => peek(k.address))
              .child(ProgramIcon(k.program, t))
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_color(t.muted)
                  .child(k.name || k.template || k.program?.name || k.address),
              )
              .when(k.status === "working", (el) =>
                el.child(StatusIcon({ icon: "spinner", color: "working", label: "Working" }, t)),
              )
              .when(k.status === "blocked" || k.status === "error", (el) =>
                el.child(
                  StatusIcon({ icon: "check-pending", color: "blocked", label: "Needs you" }, t),
                ),
              ),
          )
          .children(this.helperNodes(k.address, skip)),
        t,
      ),
    );
  },

  findingRow(stage, finding, key) {
    const t = theme();
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    return v_flex()
      .id(`factory-finding-${stage.id}-${key}`)
      .flex_none()
      .min_w(0)
      .px(8)
      .py(5)
      .gap(2)
      .child(
        div()
          .min_w(0)
          .whitespace_normal()
          .text_size(TEXT.small)
          .child(finding.title ?? finding.id ?? "Finding"),
      )
      .when(Boolean(finding.file), (el) =>
        el.child(
          div()
            .truncate()
            .text_size(TEXT.caption)
            .text_color(t.accent)
            .font_family(codeFont())
            .tooltip(where)
            .child(where),
        ),
      )
      .when(Boolean(finding.detail), (el) =>
        el.child(
          div()
            .whitespace_normal()
            .text_size(TEXT.caption)
            .text_color(t.muted)
            .child(finding.detail),
        ),
      );
  },

  followUpBox(stage) {
    const empty = !this.editor.value().trim();
    return v_flex()
      .id(`factory-followup-${stage.id}`)
      .flex_none()
      .min_w(0)
      .pt(4)
      .gap(8)
      .child(TextBox({ id: "factory-followup-input", state: this.editor, label: "Follow-up" }))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(
            Button({
              id: "factory-followup-cancel",
              label: "Close",
              onClick: (cx) => this.closeFollowUp(cx),
            }),
          )
          .child(
            Button({
              id: "factory-followup-send",
              label: this.busy ? "Sending…" : `Send to ${stage.id}`,
              primary: true,
              disabled: this.busy || empty,
              onClick: (cx) => this.sendFollowUp(stage, cx),
            }),
          ),
      );
  },

  stageDetail(stage, run) {
    const t = theme();
    const key = this.resultKey(this.folder(), stage);
    const result = this.results[key];
    const view = v_flex().min_w(0).pl(26).pb(6).gap(2);
    if (result === undefined) return view.child(Message("Loading…"));
    if (result === null) view.child(Message("No result recorded for this attempt."));
    if (result?.summary && stage.counts)
      view.child(
        div()
          .px(8)
          .py(4)
          .whitespace_normal()
          .text_size(TEXT.small)
          .text_color(t.muted)
          .child(result.summary),
      );
    for (const group of findingGroups(result)) {
      const groupKey = `findings:${group.severity}`;
      const shut = this.closedGroups.has(groupKey);
      view.child(
        GroupHeader({
          id: `factory-findings-${stage.id}-${group.severity}`,
          label: group.severity[0].toUpperCase() + group.severity.slice(1),
          count: group.findings.length,
          collapsed: shut,
          onClick: (cx) => this.toggleGroup(groupKey, cx),
        }),
      );
      if (!shut)
        view.children(
          group.findings.map((f, i) => this.findingRow(stage, f, `${group.severity}-${i}`)),
        );
    }
    const replies = Object.entries(result?.replies ?? {});
    if (replies.length) {
      view.child(
        GroupHeader({ id: `factory-replies-${stage.id}`, label: "Replies", count: replies.length }),
      );
      for (const [id, reply] of replies)
        view.child(
          div()
            .px(8)
            .py(3)
            .whitespace_normal()
            .text_size(TEXT.caption)
            .text_color(t.muted)
            .child(`${id}: ${reply}`),
        );
    }
    if (this.followUp === stage.id) return view.child(this.followUpBox(stage));
    if (!this.alive(run.orchestrator) || running(run)) return view;
    return view.child(
      h_flex().child(
        TextButton({
          id: `factory-followup-open-${stage.id}`,
          label: "Follow up",
          disabled: this.busy,
          onClick: (cx) => this.openFollowUp(stage, cx),
        }),
      ),
    );
  },

  stageButtons(stage, run, status) {
    const live = this.alive(stage.terminal);
    const active = stage.state === "working" && status.label !== "Session ended";
    const row = h_flex().flex_none().gap(2).items_center();
    if (stage.attempt > 0 && stage.state !== "queued" && !active && this.alive(run.orchestrator))
      row.child(
        IconButton({
          id: `factory-rerun-${stage.id}`,
          icon: "refresh",
          label: `Run ${stage.id} again`,
          small: true,
          disabled: this.busy,
          onClick: (cx) => this.act(["rerun", stage.id], cx),
        }),
      );
    if (live)
      row.child(
        IconButton({
          id: `factory-close-${stage.id}`,
          icon: "close",
          label: `Close ${stage.id}'s session`,
          small: true,
          disabled: this.busy,
          onClick: (cx) =>
            active
              ? this.ask(
                  `Close ${stage.id}'s session? Its work in progress stops.`,
                  "Close session",
                  (cx) => this.act(["close", stage.id], cx),
                  cx,
                )
              : this.act(["close", stage.id], cx),
        }),
      );
    if (stage.state === "done")
      row.child(
        div()
          .id(`factory-open-${stage.id}`)
          .size(22)
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .cursor_pointer()
          .accessibility_label(this.openStages.has(stage.id) ? "Hide result" : "Show result")
          .hover((s) => s.bg(theme().hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.toggleStage(stage, cx);
          })
          .child(Chevron(this.openStages.has(stage.id))),
      );
    return row;
  },

  stageNode(stage, last, run, skip) {
    const t = theme();
    const live = this.alive(stage.terminal);
    const status = stageStatus(stage, this.terminal(stage.terminal));
    const label = stageLabel(stage, status);
    const result = stageResult(stage);
    const round = stage.round > 0 ? `round ${stage.round} of ${stage.loop?.max}` : "";
    const attempt = !round && stage.attempt > 1 ? `attempt ${stage.attempt}` : "";
    const row = h_flex()
      .id(`factory-stage-${stage.id}`)
      .px(4)
      .py(4)
      .gap(7)
      .min_w(0)
      .items_start()
      .rounded(6)
      .when(live, (el) =>
        el
          .cursor_pointer()
          .accessibility_label(`Open ${stage.id}'s session`)
          .hover((s) => s.bg(t.hover))
          .on_click(() => peek(stage.terminal)),
      )
      .child(div().mt(1).child(StatusIcon(status, t)))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(
            h_flex()
              .gap(6)
              .min_w(0)
              .items_center()
              .child(div().flex_none().font_medium().child(stage.id))
              .when(Boolean(label), (el) =>
                el.child(
                  div()
                    .min_w(0)
                    .truncate()
                    .text_size(TEXT.caption)
                    .text_color(t[status.color] ?? t.dim)
                    .child(label),
                ),
              )
              .when(Boolean(round || attempt), (el) =>
                el.child(
                  div()
                    .flex_none()
                    .text_size(TEXT.caption)
                    .text_color(t.dim)
                    .child(round || attempt),
                ),
              ),
          )
          .when(Boolean(result), (el) =>
            el.child(
              div()
                .whitespace_normal()
                .text_size(TEXT.small)
                .text_color(status.color === "blocked" ? t.blocked : t.muted)
                .child(result),
            ),
          )
          .child(
            div().truncate().text_size(TEXT.caption).text_color(t.dim).child(stageDetails(stage)),
          ),
      )
      .child(this.stageButtons(stage, run, status));
    return TreeNode(
      last,
      v_flex()
        .min_w(0)
        .pb(4)
        .child(row)
        .when(this.openStages.has(stage.id) && stage.state === "done", (el) =>
          el.child(this.stageDetail(stage, run)),
        )
        .children(stage.terminal ? this.helperNodes(stage.terminal, skip) : []),
      t,
    );
  },

  confirmBlock() {
    const t = theme();
    const { message, label, action } = this.confirm;
    return v_flex()
      .id("factory-confirm")
      .flex_none()
      .mx(14)
      .mt(8)
      .p(10)
      .gap(8)
      .rounded(8)
      .border_1()
      .border_color(t.blocked)
      .bg(t.raised)
      .child(div().whitespace_normal().text_size(TEXT.small).child(message))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(
            Button({
              id: "factory-confirm-cancel",
              label: "Cancel",
              onClick: (cx) => {
                this.confirm = null;
                cx.notify();
              },
            }),
          )
          .child(Button({ id: "factory-confirm-yes", label, primary: true, onClick: action })),
      );
  },

  runView(root, run) {
    const skip = new Set(run.stages.map((s) => s.terminal).filter(Boolean));
    root.child(this.about(run));
    if (this.confirm) root.child(this.confirmBlock());
    return root.child(
      v_flex()
        .id("factory-tree")
        .flex_1()
        .min_h(0)
        .min_w(0)
        .overflow_y_scrollbar()
        .px(10)
        .py(8)
        .child(this.orchestratorRow(run))
        .child(
          v_flex()
            .flex_none()
            .pl(11)
            .min_w(0)
            .children(
              run.stages.map((s, i) => this.stageNode(s, i === run.stages.length - 1, run, skip)),
            ),
        ),
    );
  },
};
