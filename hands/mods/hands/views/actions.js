// What hands did, newest first, with each action's output file.
import { h_flex } from "gpui-base";
import { theme } from "herdr";
import { ago, baseName, DayList } from "./days.js";
import { EntryRow, RevealButton, Select, onCmdClick } from "./ui.js";

const VERBS = {
  click: "Click",
  set: "Set",
  focus: "Focus",
  type: "Type",
  key: "Press",
  scroll: "Scroll",
  shot: "Screenshot",
  record: "Record",
  "record start": "Start recording",
  "record stop": "Stop recording",
};

// The kinds to filter by, in the order a person thinks of them.
const KINDS = ["click", "set", "focus", "type", "key", "scroll", "shot", "record"];
const kindOf = (a) => (a.action.startsWith("record") ? "record" : a.action);

export function matching(actions, filter) {
  if (filter === "all") return actions;
  return actions.filter((a) => (filter === "failed" ? a.error : kindOf(a) === filter));
}

// Only what has happened is offered, and always the one chosen, even once it's gone.
function filterChoices(actions, filter) {
  const entry = (id, label, divided = false) => ({
    id,
    label: `${label} (${matching(actions, id).length})`,
    divided,
  });
  const kinds = KINDS.filter((k) => k === filter || matching(actions, k).length);
  return [
    entry("all", "All actions"),
    ...(filter === "failed" || matching(actions, "failed").length
      ? [entry("failed", "Failed")]
      : []),
    ...kinds.map((k, i) => entry(k, VERBS[k], i === 0)),
  ];
}

const FILTER_LABELS = { all: "All actions", failed: "Failed" };

export function ActionFilter({ actions, filter, open, index, focus, triggerFocus, ...handlers }) {
  const t = theme();
  return h_flex()
    .id("hands-action-filter")
    .flex_none()
    .px(14)
    .py(8)
    .border_b(1)
    .border_color(t.border)
    .child(
      Select({
        id: "hands-filter",
        label: FILTER_LABELS[filter] ?? VERBS[filter],
        accessibilityLabel: "Filter actions",
        anchor: "top_left",
        width: 190,
        small: true,
        choices: filterChoices(actions, filter),
        value: filter,
        open,
        index,
        focus,
        triggerFocus,
        ...handlers,
      }),
    );
}

// shortcut: ids repeat for two identical actions in one second, which only blurs their hover; add a sequence number if it shows.
export function actionRow(a, { onOpen, onReveal }) {
  const id = `hands-action-${a.time}-${a.action}-${a.file ?? a.target ?? ""}`;
  const title = [VERBS[a.action] ?? a.action, a.target].filter(Boolean).join(" ");
  // When first, because the terminal's name is what gets cut off for lack of room.
  const where = [ago(a.time), a.app, a.by].filter(Boolean).join(" · ");
  if (a.error)
    return EntryRow({ id, title, lead: a.error, danger: true, meta: where }).tooltip(a.error);
  const openable = a.file && !a.missing;
  const row = EntryRow({
    id,
    title,
    lead: openable ? baseName(a.file) : null,
    meta: a.missing ? `${baseName(a.file)} is gone · ${where}` : where,
    onClick: openable ? onCmdClick((cx) => onOpen(a.file, cx)) : null,
  });
  if (!openable) return row;
  return row
    .tooltip(`Cmd-click to open ${a.file}`)
    .child(RevealButton({ id: `${id}-reveal`, file: a.file, onReveal }));
}

export function ActionList({ actions, filter, onOpen, onReveal, collapsed, onToggle }) {
  return DayList({
    id: "hands-actions",
    items: matching(actions, filter),
    when: (a) => a.time,
    row: (a) => actionRow(a, { onOpen, onReveal }),
    empty: actions.length
      ? "No actions match this filter."
      : "No actions yet. They appear here as agents use `hands`.",
    collapsed,
    onToggle,
  });
}
