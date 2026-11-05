// What hands did, newest first, with each action's output file.
import { div } from "gpui-kit";
import { ago, baseName, DayList } from "./days.js";
import { EntryRow, RevealButton, onCmdClick } from "./ui.js";

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

export function ActionList({ actions, onOpen, onReveal, collapsed, onToggle }) {
  return DayList({
    id: "hands-actions",
    items: actions,
    when: (a) => a.time,
    row: (a) => actionRow(a, { onOpen, onReveal }),
    empty: "No actions yet. They appear here as agents use `hands`.",
    collapsed,
    onToggle,
  });
}
