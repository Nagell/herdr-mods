// The Events tab: the run's log, grouped by day, narrowed to one stage if wanted.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme } from "herdr";
import { eventsFor } from "../run/model.js";
import { DayList } from "./days.js";
import { TEXT, codeFont } from "./ui.js";

export const eventMethods = {
  eventFilter(run) {
    const t = theme();
    const choices = [
      { id: "all", label: "All events" },
      { id: "run", label: "The run itself" },
      ...(run?.stages ?? []).map((s, i) => ({ id: s.id, label: s.id, divided: i === 0 })),
    ];
    const value = choices.some((c) => c.id === this.eventsShown) ? this.eventsShown : "all";
    return h_flex()
      .id("factory-event-filter")
      .flex_none()
      .px(14)
      .py(8)
      .border_b(1)
      .border_color(t.border)
      .child(
        this.chooser({
          id: "factory-events-pick",
          label: choices.find((c) => c.id === value).label,
          accessibilityLabel: "Filter events",
          anchor: "top_left",
          width: 200,
          small: true,
          choices,
          value,
          triggerFocus: this.eventsTrigger,
          onChoose: (id) => {
            this.eventsShown = id;
          },
        }),
      );
  },

  eventsView(root, run) {
    const t = theme();
    const shown = run?.stages?.some((s) => s.id === this.eventsShown) || this.eventsShown === "run";
    return root.child(this.eventFilter(run)).child(
      DayList({
        id: "factory-events",
        items: eventsFor(run, shown ? this.eventsShown : "all"),
        when: (e) => e.at,
        row: (e, i) =>
          h_flex()
            .id(`factory-event-${e.at}-${i}`)
            .flex_none()
            .px(8)
            .py(5)
            .gap(10)
            .min_w(0)
            .items_start()
            .rounded(7)
            .hover((s) => s.bg(t.hover))
            .child(
              div()
                .flex_none()
                .text_size(TEXT.caption)
                .text_color(t.dim)
                .font_family(codeFont())
                .child(e.at.slice(11, 16)),
            )
            .child(
              div()
                .flex_1()
                .min_w(0)
                .whitespace_normal()
                .text_size(TEXT.small)
                .text_color(t.muted)
                .child(e.text),
            ),
        empty: run?.events?.length ? "No events match this filter." : "Nothing has happened yet.",
        collapsed: this.closedGroups,
        onToggle: (key, cx) => this.toggleGroup(key, cx),
      }),
    );
  },
};
