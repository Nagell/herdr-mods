// The button that hides and shows the right panel, in its own small block beside
// the tab bar, and the key command that does the same.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, props, layout, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export class PanelToggle {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "toggle-panel") this.toggle();
    });
  }

  panel() {
    return find(layout(), props()?.target ?? "panel");
  }

  // Hide the container, not its active child, so reopening keeps the selection.
  toggle() {
    const panel = this.panel();
    if (panel) run("layout.toggle", { id: panel.id });
  }

  render() {
    const t = theme();
    const panel = this.panel();
    const bar = h_flex()
      .id("panel-toggle-bar")
      .size_full()
      .pr(10)
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border);
    if (!panel) return bar;
    const label = panel.hidden ? "Show sidebar" : "Hide sidebar";
    return bar.child(
      div()
        .id("panel-toggle")
        .size(26)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(panel.hidden ? t.dim : t.foreground)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .accessibility_label(label)
        .tooltip(label)
        .on_click(() => this.toggle())
        .child(svg("mods/better-sidebar/panel-right.svg").size(16)),
    );
  }
}
