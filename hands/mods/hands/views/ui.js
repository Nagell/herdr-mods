// The design kit: Herdr's own conventions as tokens and small components, with
// only what this mod uses. Components return ordinary elements, so callers can chain.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, settings } from "herdr";

// Plain px: Herdr scales a mod's sizes by zoom itself.
export const TEXT = { badge: 10, caption: 11, small: 12, tab: 12.8, body: 13 };

export const codeFont = () => settings().font_family ?? "JetBrains Mono";

export const Icon = (name, size = 14) => svg(`mods/hands/icons/${name}.svg`).size(size).flex_none();

// One turn of a spinning icon, the speed of Herdr's own spinner.
export const SPIN_MS = 900;

// A sidebar panel's frame.
export function Panel({ id }) {
  const t = theme();
  return v_flex()
    .id(id)
    .size_full()
    .min_h(0)
    .overflow_hidden()
    .rounded(10)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .text_color(t.foreground)
    .text_size(TEXT.body);
}

export function PanelHeader() {
  const t = theme();
  return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border);
}

export function IconButton({ id, icon, label, onClick, spinning = false }) {
  const t = theme();
  return div()
    .id(id)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .text_color(t.dim)
    .accessibility_label(label)
    .tooltip(label)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(spinning ? Icon(icon, 15).spin(SPIN_MS) : Icon(icon, 15));
}

function Badge(text) {
  const t = theme();
  return div()
    .flex_none()
    .px(5)
    .py(1)
    .rounded(4)
    .border_1()
    .border_color(t.border)
    .text_size(TEXT.badge)
    .text_color(t.muted)
    .child(String(text));
}

// A panel title that doubles as a tab, the same pill as Herdr's tab bar.
export function HeaderTab({ id, label, count, active, onClick }) {
  const t = theme();
  return h_flex()
    .id(id)
    .h(29)
    .flex_none()
    .px(10)
    .gap(7)
    .items_center()
    .rounded(7)
    .border(1)
    .border_color(active ? t.border : t.background)
    .bg(active ? t.raised : t.background)
    .text_size(TEXT.tab)
    .text_color(active ? t.foreground : t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .role("tab")
    .aria_selected(Boolean(active))
    .on_click((_e, cx) => onClick(cx))
    .child(label)
    .child(Badge(count));
}

// A section heading in a list, as in Herdr's agents list. With `onClick` it
// collapses its section; `divided` draws the rule that separates it from the last.
export function GroupHeader({ id, label, count, collapsed = false, divided = false, onClick }) {
  const t = theme();
  return h_flex()
    .id(id)
    .h(30)
    .flex_none()
    .px(8)
    .gap(6)
    .items_center()
    .text_size(TEXT.caption)
    .text_color(t.muted)
    .when(divided, (el) => el.mt(4).border_t(1).border_color(t.border))
    .when(Boolean(onClick), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => onClick(cx))
        .child(
          div()
            .w(14)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .text_color(t.dim)
            .child(Icon(collapsed ? "chevron-right" : "chevron-down", 12)),
        ),
    )
    .child(div().flex_none().font_medium().child(label))
    .child(Badge(count));
}

// A two-line list entry, the shape of a commit: a title, then its details in
// small print. `lead` starts the details in the accent colour, or in red with
// `danger`. Chain the row's right-hand side onto what this returns.
export function EntryRow({ id, title, lead, danger = false, meta, onClick }) {
  const t = theme();
  const details = h_flex()
    .min_w(0)
    .gap(4)
    .text_size(TEXT.caption)
    .text_color(t.dim)
    .when(Boolean(lead), (el) =>
      el
        .child(
          div()
            .flex_none()
            .max_w(danger ? 240 : 190) // The file or error matters most; the details give way.
            .truncate()
            .text_color(danger ? t.ansi1 : t.accent)
            .child(lead),
        )
        .child(div().flex_none().child("·")),
    )
    .child(div().flex_1().min_w(0).truncate().child(meta));
  return h_flex()
    .id(id)
    .flex_none()
    .px(8)
    .py(6)
    .gap(8)
    .items_center()
    .rounded(7)
    .when(Boolean(onClick), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((event, cx) => onClick(event, cx)),
    )
    .child(v_flex().flex_1().min_w(0).gap(1).child(div().truncate().child(title)).child(details));
}

export function Message(text, error = false) {
  const t = theme();
  return div()
    .flex_none()
    .p(8)
    .text_size(TEXT.small)
    .whitespace_normal()
    .text_color(error ? t.ansi1 : t.dim)
    .child(text);
}

// Files open on Cmd-click, like a link in a terminal, so a stray click can't launch a movie.
export const onCmdClick = (open) => (event, cx) => {
  if (event.modifiers?.platform) open(cx);
};

export const RevealButton = ({ id, file, onReveal }) =>
  IconButton({
    id,
    icon: "folder",
    label: "Show in Finder",
    onClick: (cx) => onReveal(file, cx),
  });
