// A history: entries under a collapsible heading per day.
import { v_flex } from "gpui-base";
import { GroupHeader, Message } from "./ui.js";

// Spelled out here: this runtime ignores the options of toLocaleDateString.
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export function dayLabel(iso) {
  const day = (date) => new Date(date).toDateString();
  if (day(iso) === day(Date.now())) return "Today";
  if (day(iso) === day(Date.now() - 86400000)) return "Yesterday";
  const date = new Date(iso);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

// Items arrive newest first, so each day's are already together.
function byDay(items, when) {
  const days = new Map();
  for (const item of items) {
    const label = dayLabel(when(item));
    days.set(label, [...(days.get(label) ?? []), item]);
  }
  return [...days].map(([label, entries]) => ({ label, entries }));
}

export function DayList({ id, items, when, row, empty, collapsed, onToggle }) {
  const list = v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().p(6);
  if (!items.length) return list.child(Message(empty));
  byDay(items, when).forEach(({ label, entries }, i) => {
    const key = `${id}:${label}`;
    const shut = collapsed.has(key);
    list.child(
      GroupHeader({
        id: `${id}-day-${label}`,
        label,
        count: entries.length,
        collapsed: shut,
        divided: i > 0,
        onClick: (cx) => onToggle(key, cx),
      }),
    );
    if (!shut) list.children(entries.map(row));
  });
  return list;
}
