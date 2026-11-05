// The Events tab: the run's log, grouped by day, narrowed to one stage if wanted.
import { div } from "gpui-kit";
import { h_flex, TextView } from "gpui-base";
import { theme } from "herdr";
import { eventsFor, titleCase } from "../run/model.js";
import { DayList } from "./days.js";
import { TEXT, codeFont } from "./ui.js";

// The badge says whose event it is, so the text needn't.
const eventWho = (e, run) => (e.stage ? `${run.workflow}:${e.stage}` : run.workflow);
const eventText = (e) => {
  const own = e.stage && e.text.startsWith(`${e.stage} `);
  const text = own ? e.text.slice(e.stage.length + 1) : e.text;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// The badge and message flow as one paragraph, beside the time's own column. A stage's
// summary is an agent's words, so it's escaped: it can't add markup or links to the panel.
const escaped = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eventHtml = (e, run) =>
  `<code>${escaped(eventWho(e, run))}</code> ${escaped(eventText(e))}`;

export const eventMethods = {
  eventFilter(run) {
    const t = theme();
    const choices = [
      { id: "all", label: "All events" },
      { id: "run", label: "The run itself" },
      ...(run?.stages ?? []).map((s, i) => ({ id: s.id, label: titleCase(s.id), divided: i === 0 })),
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
                .child(e.at.slice(11, 16)), // Always 24-hour: the helper writes it so.
            )
            .child(
              div()
                .flex_1()
                .min_w(0)
                .child(
                  TextView.html(`factory-event-text-${e.at}-${i}`, eventHtml(e, run))
                    .text_size(TEXT.small)
                    .text_color(t.muted)
                    .w_full()
                    .min_w(0)
                    .scrollable(false),
                ),
            ),
        empty: run?.events?.length ? "No events match this filter." : "Nothing has happened yet.",
        collapsed: this.closedGroups,
        onToggle: (key, cx) => this.toggleGroup(key, cx),
      }),
    );
  },
};
