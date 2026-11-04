// The sidebar's last line: Settings and Add machine as icons. Herdr's own footer
// gives each a labelled row, which costs twice the height.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, updates } from "herdr";

export class Footer {
  init() {}

  button(id, label, action, t, icons) {
    return h_flex()
      .id(id)
      .h(26)
      .px(6)
      .gap(3)
      .flex_none()
      .items_center()
      .rounded(6)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .accessibility_label(label)
      .tooltip(label)
      .on_click(action)
      .children(icons);
  }

  render() {
    const t = theme();
    const icon = (name, size = 14) => svg(`mods/better-sidebar/${name}.svg`).size(size).flex_none();
    return h_flex()
      .id("sidebar-footer")
      .size_full()
      .px(8)
      .gap(2)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .child(
        this.button("settings", "Settings", () => run("app.settings"), t, [
          icon("settings"),
          // An update is ready.
          ...(updates().app.ready ? [div().size(6).rounded_full().bg(t.accent)] : []),
        ]),
      )
      .child(
        this.button("machine", "Add machine", () => run("mod.open", { name: "machine-add" }), t, [
          icon("plus", 12),
          icon("server"),
        ]),
      );
  }
}
