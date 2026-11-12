// Better Icons holds the Material Icon Theme's icons for this repo's mods, which read them by
// path. It needs no block in a layout; shown anyway, it lists a few names with their icons.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { fileIcon, isLight, loadFileIcons } from "./file-icons.js";

const SAMPLES = [
  ["src", true],
  [".github/workflows", true],
  ["package.json", false],
  ["main.ts", false],
  ["main.spec.ts", false],
  ["README.md", false],
  ["Dockerfile", false],
];

export default class BetterIcons extends View {
  init(_props, cx) {
    this.table = null;
    this.loaded = false;
    cx.spawn(async (cx) => {
      this.table = await loadFileIcons();
      this.loaded = true;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const light = isLight(t.background);
    const note = !this.loaded ? "Loading icons…" : this.table ? `Icons from ${this.table.source}` : "icons.json is missing or unreadable.";
    return v_flex()
      .id("better-icons")
      .size_full()
      .p(10)
      .gap(4)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(div().text_size(12).text_color(t.dim).child(note))
      .children(
        this.table
          ? SAMPLES.map(([name, dir]) =>
              h_flex()
                .id(`better-icons-${name}`)
                .h(26)
                .gap(8)
                .items_center()
                .child(image(fileIcon(this.table, name, { dir, light })).size(16).flex_none())
                .child(div().truncate().child(name)),
            )
          : [],
      );
  }
}
