// Screenshots and past recordings, what a recording holds, and whether one is running now.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import { actionRow } from "./actions.js";
import { ago, baseName, DayList } from "./days.js";
import {
  TEXT,
  codeFont,
  Icon,
  EntryRow,
  GroupHeader,
  IconButton,
  Message,
  PanelHeader,
  RevealButton,
  onCmdClick,
} from "./ui.js";

const subject = (r) => (r.app ? (r.window ? `${r.app}, ${r.window}` : r.app) : "Whole screen");

function length(seconds) {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}m ${total % 60}s` : `${total}s`;
}

function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function recordingRow(r, onOpen, t) {
  const details = [
    ...(r.note ? [subject(r)] : []),
    ago(r.started),
    ...(r.missing ? ["movie is gone"] : []),
  ];
  return EntryRow({
    id: `hands-recording-${r.file}`,
    title: r.note || subject(r),
    meta: details.join(" · "),
    onClick: (_e, cx) => onOpen(r.file, cx),
  }).child(
    div()
      .flex_none()
      .text_size(TEXT.caption)
      .text_color(t.dim)
      .font_family(codeFont())
      .child(length(r.seconds)),
  );
}

// Screenshots and recordings together, newest first.
export function capturesFrom(actions, recordings) {
  const shots = actions
    .filter((a) => a.action === "shot" && !a.error && a.file)
    .map((action) => ({ when: action.time, action }));
  const movies = recordings.map((recording) => ({ when: recording.started, recording }));
  return [...shots, ...movies].sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
}

export function CaptureList({ captures, onSelect, onOpen, onReveal, collapsed, onToggle }) {
  const t = theme();
  return DayList({
    id: "hands-captures",
    items: captures,
    when: (c) => c.when,
    row: (c) =>
      c.recording
        ? recordingRow(c.recording, onSelect, t)
        : actionRow(c.action, { onOpen, onReveal }),
    empty: "No screenshots or recordings yet. They appear here as agents use `hands`.",
    collapsed,
    onToggle,
  });
}

export function RecordingHeader({ recording: r, onBack, onReveal }) {
  const t = theme();
  return PanelHeader()
    .px(8)
    .gap(4)
    .child(
      IconButton({
        id: "hands-back",
        icon: "chevron-left",
        label: "Back to captures",
        onClick: onBack,
      }),
    )
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(TEXT.small)
        .text_color(t.dim)
        .font_family(codeFont())
        .child(length(r.seconds)),
    )
    .when(!r.missing, (el) =>
      el.child(RevealButton({ id: "hands-movie-reveal", file: r.file, onReveal })),
    );
}

function about(r, t) {
  const when = new Date(r.started).toLocaleString();
  return v_flex()
    .id("hands-about")
    .flex_none()
    .px(14)
    .py(10)
    .gap(4)
    .border_b(1)
    .border_color(t.border)
    .child(
      div()
        .font_medium()
        .whitespace_normal()
        .child(r.note || subject(r)),
    )
    .child(
      div()
        .text_size(TEXT.caption)
        .text_color(t.dim)
        .whitespace_normal()
        .child(`${r.note ? `${subject(r)} · ` : ""}${when}`),
    );
}

function movieRow(r, onOpen, t) {
  return h_flex()
    .id("hands-movie")
    .h(28)
    .flex_none()
    .px(8)
    .gap(6)
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .tooltip(`Cmd-click to open ${r.file}`)
    .on_click(onCmdClick((cx) => onOpen(r.file, cx)))
    .child(Icon("file").text_color(t.muted))
    .child(div().flex_1().min_w(0).truncate().text_color(t.accent).child(baseName(r.file)))
    .child(div().flex_none().text_size(TEXT.caption).text_color(t.dim).child(fileSize(r.bytes)));
}

// What happened during a recording, in the order it happened. The list holds
// only recent actions, so an old recording may have none left.
function actionsDuring(r, actions) {
  const [start, end] = [Date.parse(r.started), Date.parse(r.ended)];
  return actions
    .filter((a) => {
      const at = Date.parse(a.time);
      return a.action !== "record" && at >= start && at <= end && (!r.app || a.app === r.app);
    })
    .reverse();
}

export function RecordingDetail({ recording: r, actions, onOpen, onReveal }) {
  const t = theme();
  const files = v_flex().id("hands-files").flex_none().p(6);
  if (r.missing) files.child(Message(`Gone from ${r.file}`));
  else
    files
      .child(GroupHeader({ id: "hands-files-group", label: "Files", count: 1 }))
      .child(movieRow(r, onOpen, t));
  const during = actionsDuring(r, actions);
  if (during.length)
    files
      .child(
        GroupHeader({
          id: "hands-during-group",
          label: "Actions",
          count: during.length,
          divided: true,
        }),
      )
      .children(during.map((a) => actionRow(a, { onOpen, onReveal })));
  return v_flex()
    .id("hands-detail")
    .flex_1()
    .min_h(0)
    .overflow_y_scrollbar()
    .child(about(r, t))
    .child(files);
}

export function RecordingStatus(recording) {
  const t = theme();
  const running = Boolean(recording?.running);
  return h_flex()
    .id("hands-recording")
    .h(34)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .border_t(1)
    .border_color(t.border)
    .text_size(TEXT.caption)
    .text_color(t.dim)
    .child(
      div()
        .size(8)
        .flex_none()
        .rounded(4)
        .bg(running ? t.blocked : t.dim),
    )
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .child(running ? `Recording ${recording.file}` : "Not recording"),
    );
}
