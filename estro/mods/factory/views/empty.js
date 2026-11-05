// No run here: what to run, and how. The /factory skill starts runs, not this panel.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, theme } from "herdr";
import { chain } from "../run/model.js";
import { TEXT, codeFont, GroupHeader, Message, TextButton } from "./ui.js";

export const emptyMethods = {
  emptyView(root) {
    const t = theme();
    const workflows = this.workflows ?? [];
    const body = v_flex().id("factory-empty").flex_1().min_h(0).overflow_y_scrollbar().p(6);
    body.child(Message("No run here. Ask an agent in this space to start one with /factory."));
    if (this.workflows && !workflows.length)
      body.child(
        Message(`No workflows. Add one to ${home()}/.config/herdr-mods/factory/workflow.json.`),
      );
    if (workflows.length) {
      body.child(
        GroupHeader({ id: "factory-workflows", label: "Workflows", count: workflows.length }),
      );
      for (const w of workflows)
        body.child(
          v_flex()
            .id(`factory-workflow-${w.name}`)
            .flex_none()
            .min_w(0)
            .px(8)
            .py(5)
            .gap(1)
            .child(
              div()
                .truncate()
                .font_family(codeFont())
                .text_size(TEXT.small)
                .child(`/factory ${w.name}`),
            )
            .child(div().truncate().text_size(TEXT.caption).text_color(t.dim).child(chain(w)))
            .when(Boolean(w.description), (el) =>
              el.child(
                div()
                  .whitespace_normal()
                  .text_size(TEXT.caption)
                  .text_color(t.muted)
                  .child(w.description),
              ),
            ),
        );
    }
    return root.child(
      body.child(
        h_flex()
          .px(2)
          .pt(4)
          .child(
            TextButton({
              id: "factory-open-folder",
              label: "Open workflows folder",
              onClick: (cx) => this.openConfig(cx),
            }),
          ),
      ),
    );
  },
};
