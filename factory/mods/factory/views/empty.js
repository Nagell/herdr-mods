// No run here: how to start one.
import { Message } from "./ui.js";
import { v_flex } from "gpui-base";

export const emptyMethods = {
  emptyView(root) {
    return root.child(
      v_flex()
        .id("factory-empty")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .p(6)
        .child(Message("No run here. Start one from Workflows, or ask an agent with /factory.")),
    );
  },
};
