// hands: the sidebar for the `hands` CLI. A block asks for whichever
// permission is missing and goes away once both are granted; below it, past
// recordings, each opening to what it holds and where its movie is. Everything
// else is the CLI (`hands --help`).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, theme, settings } from "herdr";
import { loadSettings, duration } from "./settings.js";

const POLL_MS = 5000;
// The pane's own preference; the CLI reads the rest of the block itself.
const DEFAULT_SETTINGS = { pane: { refresh: "5s" } };

const PERMISSIONS = [
  {
    key: "accessibility",
    label: "Accessibility",
    why: "Read and operate other apps",
    settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  },
  {
    key: "screen",
    label: "Screen Recording",
    why: "Screenshots and recordings",
    settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  },
];

const em = (factor) => {
  const s = settings?.() ?? {};
  return (s.ui_font_size ?? s.font_size ?? 14) * factor;
};

const subject = (r) => (r.app ? (r.window ? `${r.app}, ${r.window}` : r.app) : "Whole screen");

function length(seconds) {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const m = Math.floor(total / 60);
  return m ? `${m}m ${total % 60}s` : `${total}s`;
}

function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function ago(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(minutes >= 1)) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default class Hands extends View {
  init(_props, cx) {
    this.permissions = null; // {accessibility, screen} once read
    this.recording = null; // {running, file} once read
    this.recordings = []; // finished, newest first
    this.selected = null; // the movie path of the open recording
    this.error = null;
    this.asking = null; // the permission being asked for
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
        this.recordings = await this.hands(["record", "list"]);
        this.error = null;
      } catch (e) {
        this.error = e.message;
      }
      cx.notify();
    });
  }

  // macOS shows its prompt only once per app, so a permission still missing
  // after asking is granted in System Settings, which this opens at the place.
  ask(permission, cx) {
    if (this.asking) return;
    this.asking = permission.key;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.permissions = await this.hands(["permissions", `--ask=${permission.key}`]);
        if (!this.permissions[permission.key]) await exec("open", [permission.settings], {});
        this.error = null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.asking = null;
        cx.notify();
      }
    });
  }

  openMovie(file, cx) {
    cx.spawn(async (cx) => {
      const result = await exec("open", [file], {});
      this.error = result.code === 0 ? null : result.stderr?.trim() || `Could not open ${file}`;
      cx.notify();
    });
  }

  iconButton(id, name, label, action, t) {
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .accessibility_label(label)
      .tooltip(label)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx))
      .child(svg(`mods/hands/${name}.svg`).size(15));
  }

  headerView(t, open) {
    const header = h_flex()
      .h(42)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border);
    if (open)
      header.child(
        this.iconButton(
          "hands-back",
          "back",
          "Back to recordings",
          (cx) => {
            this.selected = null;
            cx.notify();
          },
          t,
        ),
      );
    return header
      .child(div().font_semibold().child(open ? "Recording" : "Hands"))
      .child(div().flex_1())
      .child(this.iconButton("hands-refresh", "refresh", "Refresh", (cx) => this.refresh(cx), t));
  }

  permissionRow(permission, t) {
    const granted = Boolean(this.permissions[permission.key]);
    const asking = this.asking === permission.key;
    return h_flex()
      .id(`hands-${permission.key}`)
      .gap(8)
      .items_center()
      .child(
        div()
          .size(8)
          .flex_none()
          .rounded(4)
          .bg(granted ? t.done : t.blocked),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().text_color(t.foreground).child(permission.label))
          .child(div().text_size(em(0.8)).text_color(t.dim).child(permission.why)),
      )
      .child(
        granted
          ? div().text_size(em(0.85)).text_color(t.dim).child("Granted")
          : h_flex()
              .id(`hands-ask-${permission.key}`)
              .flex_none()
              .min_h(30)
              .px(10)
              .py(5)
              .items_center()
              .rounded(6)
              .border_1()
              .border_color(t.border)
              .bg(t.raised)
              .text_size(em(0.85))
              .text_color(this.asking ? t.dim : t.foreground)
              .accessibility_label(`Grant ${permission.label} access to Herdr`)
              .when(!this.asking, (el) =>
                el
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.ask(permission, cx)),
              )
              .child(asking ? "Asking…" : "Grant access"),
      );
  }

  permissionsBlock(t) {
    const block = v_flex()
      .id("hands-permissions")
      .flex_none()
      .m(14)
      .mb(0)
      .p(10)
      .gap(10)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.raised)
      .child(div().font_medium().text_color(t.foreground).child("Herdr needs permission"));
    for (const permission of PERMISSIONS) block.child(this.permissionRow(permission, t));
    return block;
  }

  listView(t) {
    const list = v_flex().id("hands-recordings").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(2);
    if (!this.recordings.length)
      list.child(
        div()
          .p(6)
          .text_size(em(0.95))
          .text_color(t.dim)
          .whitespace_normal()
          .child("No recordings yet. They appear here after `hands record stop`."),
      );
    for (const r of this.recordings)
      list.child(
        v_flex()
          .id(`hands-recording-${r.file}`)
          .flex_none()
          .p(8)
          .gap(3)
          .rounded(5)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .accessibility_label(`Recording of ${subject(r)}`)
          .on_click((_e, cx) => {
            this.selected = r.file;
            cx.notify();
          })
          .child(
            div()
              .truncate()
              .text_size(em(0.95))
              .text_color(t.foreground)
              .child(r.note || subject(r)),
          )
          .child(
            div()
              .truncate()
              .text_size(em(0.8))
              .text_color(t.dim)
              .child(
                [
                  ...(r.note ? [subject(r)] : []),
                  ago(r.started),
                  length(r.seconds),
                  ...(r.missing ? ["movie is gone"] : []),
                ].join(" · "),
              ),
          ),
      );
    return list;
  }

  field(label, value, t) {
    return v_flex()
      .gap(2)
      .child(div().text_size(em(0.8)).text_color(t.dim).child(label))
      .child(div().text_color(t.foreground).whitespace_normal().child(value));
  }

  detailView(r, t) {
    const detail = v_flex().id("hands-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(12);
    if (r.note) detail.child(this.field("Summary", r.note, t));
    detail
      .child(this.field("Recorded", subject(r), t))
      .child(this.field("Started", new Date(r.started).toLocaleString(), t))
      .child(this.field("Length", length(r.seconds), t));
    if (!r.missing) detail.child(this.field("Size", fileSize(r.bytes), t));
    const location = `file://${encodeURI(r.file)}`;
    detail.child(
      v_flex()
        .gap(2)
        .child(div().text_size(em(0.8)).text_color(t.dim).child("Movie"))
        .child(
          r.missing
            ? div().text_color(t.dim).whitespace_normal().child(`Gone from ${r.file}`)
            : div()
                .id("hands-movie")
                .text_color(t.accent)
                .whitespace_normal()
                .cursor_pointer()
                .hover((s) => s.underline())
                .role("link")
                .tooltip("Open the movie")
                .on_click((_e, cx) => this.openMovie(r.file, cx))
                .child(location),
        ),
    );
    return detail;
  }

  footerView(t) {
    const running = Boolean(this.recording?.running);
    return h_flex()
      .id("hands-recording")
      .h(34)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(em(0.85))
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
          .child(running ? `Recording ${this.recording.file}` : "Not recording"),
      );
  }

  render(cx) {
    const t = theme();
    const p = this.permissions;
    const open = this.recordings.find((r) => r.file === this.selected);
    const root = v_flex()
      .id("hands")
      .size_full()
      .min_w(0)
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(em(1))
      .border_1()
      .border_color(t.border)
      .child(this.headerView(t, Boolean(open)));
    if (p && (!p.accessibility || !p.screen)) root.child(this.permissionsBlock(t));
    if (this.error)
      root.child(
        div()
          .flex_none()
          .px(14)
          .py(5)
          .text_size(em(0.85))
          .text_color(t.blocked)
          .whitespace_normal()
          .child(this.error),
      );
    return root.child(open ? this.detailView(open, t) : this.listView(t)).child(this.footerView(t));
  }
}
