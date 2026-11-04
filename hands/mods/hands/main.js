// hands: a tiny pane showing whether Herdr holds the two permissions the
// `hands` CLI needs, a button that asks for them, and whether a screen
// recording is running. Everything else is the CLI (`hands --help`).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, theme, settings } from "herdr";
import { loadSettings, duration } from "./settings.js";

const POLL_MS = 5000;
// The pane's own preference; the CLI reads the rest of the block itself.
const DEFAULT_SETTINGS = { pane: { refresh: "5s" } };

const em = (factor) => {
  const s = settings?.() ?? {};
  return (s.ui_font_size ?? s.font_size ?? 14) * factor;
};

export default class Hands extends View {
  init(_props, cx) {
    this.permissions = null; // {accessibility, screen} once read
    this.recording = null; // {running, file} once read
    this.error = null;
    this.asking = false;
    this.refresh(cx);
    cx.spawn(async (cx) => {
      const { settings } = await loadSettings("hands", DEFAULT_SETTINGS);
      const every = Math.max(1000, duration(settings.pane.refresh, POLL_MS));
      cx.timer.every(every, (cx) => this.refresh(cx));
    });
  }

  binary() {
    return `${appHome()}/mods/hands/bin/hands`;
  }

  async hands(args) {
    const result = await exec(this.binary(), [...args, "--json"], {});
    let data = null;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw new Error(result.stderr?.trim() || "hands returned no JSON");
    }
    if (result.code !== 0) throw new Error(result.stderr?.trim() || "hands failed");
    return data;
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        this.permissions = await this.hands(["permissions"]);
        this.recording = await this.hands(["record", "status"]);
        this.error = null;
      } catch (e) {
        this.error = e.message;
      }
      cx.notify();
    });
  }

  // Opens the system prompts; the person then allows Herdr in System Settings.
  ask(cx) {
    if (this.asking) return;
    this.asking = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.permissions = await this.hands(["permissions", "--ask"]);
        this.error = null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.asking = false;
        cx.notify();
      }
    });
  }

  row(id, label, granted, t) {
    return h_flex()
      .id(id)
      .gap(8)
      .items_center()
      .child(
        div()
          .size(9)
          .flex_none()
          .rounded(5)
          .bg(granted === null ? t.dim : granted ? t.ansi2 : t.ansi1),
      )
      .child(div().flex_1().child(label))
      .child(
        div()
          .text_color(t.dim)
          .child(granted === null ? "checking" : granted ? "granted" : "missing"),
      );
  }

  render(cx) {
    const t = theme();
    const p = this.permissions;
    const missing = p && (!p.accessibility || !p.screen);
    const root = v_flex()
      .id("hands")
      .size_full()
      .p(12)
      .gap(8)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .rounded(10)
      .text_size(em(0.85))
      .text_color(t.foreground)
      .child(div().font_medium().child("hands"))
      .child(this.row("hands-accessibility", "Accessibility", p ? Boolean(p.accessibility) : null, t))
      .child(this.row("hands-screen", "Screen Recording", p ? Boolean(p.screen) : null, t));
    if (missing)
      root.child(
        h_flex()
          .id("hands-ask")
          .self_start()
          .px(10)
          .py(5)
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .bg(t.raised)
          .text_color(this.asking ? t.dim : t.foreground)
          .accessibility_label("Grant access to Herdr")
          .when(!this.asking, (el) =>
            el
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.ask(cx)),
          )
          .child(this.asking ? "Asking…" : "Grant access"),
      );
    root.child(
      h_flex()
        .id("hands-recording")
        .gap(8)
        .items_center()
        .child(
          div()
            .size(9)
            .flex_none()
            .rounded(5)
            .bg(this.recording?.running ? t.ansi1 : t.dim),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .child(this.recording?.running ? `Recording ${this.recording.file}` : "Not recording"),
        ),
    );
    if (this.error) root.child(div().text_color(t.ansi1).whitespace_normal().child(this.error));
    return root;
  }
}
