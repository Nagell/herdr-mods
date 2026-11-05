// A file in the centre pane, read-only, following the file as it changes on disk. Editing
// belongs in the code editor it can open.
import { div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState } from "gpui-base";
import { exec, focused, layout, panes, readTextFile, setShared, settings, shared, theme } from "herdr";
import { baseName, languageOf, parseHunks, viewable } from "../files/model.js";
import { viewerEntries } from "../actions/open.js";
import { foundEditors } from "../actions/outside.js";
import { TEXT, Icon, Message, MenuButton, TextButton, codeFont, codeSize } from "./ui.js";

const GUTTER_WIDTH = 4;
const END_ROOM = 40; // So the last line isn't cut off by the editor's own padding.
const DEVICE_SCALE = 2;
// GPUI's default line height, rounded to whole device pixels at this zoom.
const LINE_RATIO = 1.618034;

export function lineHeight() {
  const zoom = settings().zoom ?? 1;
  const scale = zoom * DEVICE_SCALE;
  return Math.round(codeSize() * scale * LINE_RATIO) / scale;
}

export const viewerMethods = {
  // What this tab shows: the registry, then what it was opened with, after a restart.
  viewerEntry() {
    return viewerEntries()[this.viewerId] ?? null;
  },

  // Runs as the tab opens, which is when the focused tab is its own.
  claimTab() {
    const entry = this.viewerEntry();
    if (entry?.tab) return;
    const tab = focused()?.tab;
    if (!tab || !panes().some((p) => p.tab === tab && p.mod === "better-files")) return;
    // A tab reopened behind another one must not take that one's place.
    if (Object.values(viewerEntries()).some((other) => other.tab === tab)) return;
    if (entry?.others?.includes(tab)) return;
    this.setViewer(this.viewerId, {
      tab,
      space: entry?.space ?? this.viewerSpace,
      file: entry?.file ?? this.viewerFile,
      preview: entry?.preview ?? false,
    });
  },

  syncViewer(cx) {
    this.claimTab();
    const file = this.viewerEntry()?.file ?? this.viewerFile;
    if (!file) return;
    if (file.path !== this.file?.path) {
      this.file = file;
      this.text = undefined;
      this.problem = null;
      this.code?.release();
      this.code = null;
      this.hunks = [];
      this.readFile(cx);
      this.readHunks(cx);
      cx.notify();
    }
    this.publishHead();
  },

  // Asked on every check, not just when the text changes: a commit clears marks without
  // touching the file.
  readHunks(cx) {
    const file = this.file;
    if (!file || !this.gutterOn || this.diffing) return;
    this.diffing = true;
    cx.spawn(async (cx) => {
      const git = (args) =>
        exec("git", ["--no-optional-locks", ...args], { cwd: file.root, on: file.on }).catch(() => null);
      let marks = [];
      const status = await git(["status", "--porcelain=v1", "--", file.path]);
      if (status?.code === 0 && status.stdout.startsWith("??")) {
        marks = [{ line: 0, count: Infinity, kind: "added" }];
      } else if (status?.code === 0 && status.stdout.trim()) {
        const diff = await git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U0", "HEAD", "--", file.path]);
        if (diff?.code === 0) marks = parseHunks(diff.stdout);
      }
      this.diffing = false;
      if (this.file?.path !== file.path) return;
      if (JSON.stringify(marks) !== JSON.stringify(this.hunks)) {
        this.hunks = marks;
        cx.notify();
      }
    });
  },

  // Only a real change touches the view, so the place you're reading stays put.
  readFile(cx) {
    const file = this.file;
    if (!file || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      let shown;
      try {
        shown = viewable(await readTextFile(file.path, { on: file.on }));
      } catch {
        shown = { problem: "This file can't be shown: it's too large, or can't be read." };
      }
      this.reading = false;
      if (this.file?.path !== file.path) return;
      if (shown.problem) {
        this.problem = shown.problem;
        this.text = undefined;
        this.code?.release();
        this.code = null;
      } else if (shown.text !== this.text) {
        this.problem = null;
        this.text = shown.text;
        if (this.code) this.code.set_value(shown.text);
        else this.code = this.newCode(file, shown.text);
      }
      cx.notify();
    });
  },

  newCode(file, value) {
    const t = theme();
    return EditorState.new({
      language: languageOf(file.path),
      readonly: true,
      // A folded section would pull the gutter out of line with the file.
      folding: !this.gutterOn,
      value,
      font_family: codeFont(),
      font_size: codeSize(),
      syntax: {
        keyword: t.ansi5,
        string: t.ansi2,
        comment: t.dim,
        function: t.ansi4,
        type: t.ansi3,
        number: t.ansi1,
        constant: t.ansi6,
      },
    });
  },

  // What the pane's header row says, the same row a diff uses: file, folder, and whether
  // this is the shared tab.
  viewerHead() {
    const file = this.file;
    if (!file) return null;
    const name = baseName(file.path);
    const folder = file.path.slice(file.root.length + 1, -name.length - 1);
    return {
      title: name,
      detail: [folder, this.viewerEntry()?.preview ? "Preview" : null].filter(Boolean).join(" · "),
      icon: "mods/better-files/icons/file.svg",
    };
  },

  publishHead() {
    const tab = this.viewerEntry()?.tab;
    const pane = tab && panes().find((p) => p.mod === "better-files" && p.tab === tab)?.pane;
    const head = this.viewerHead();
    if (!pane || !head) return;
    const heads = shared("pane-heads") ?? {};
    if (JSON.stringify(heads[pane]) !== JSON.stringify(head))
      setShared("pane-heads", { ...heads, [pane]: head });
  },

  // Better Changes' pane header shows a published title. With any other header, the file
  // draws its own row, so there's always exactly one.
  headerShowsTitle() {
    const find = (node) =>
      node?.content?.pane?.header?.content?.mod ?? (node?.children ?? []).map(find).find(Boolean);
    return find(layout()) === "better-changes";
  },

  // Herdr's editor can't mark a line or say how far it has scrolled. So it's made as tall as
  // the whole file, which leaves it nothing to scroll, and this outer box scrolls it and the
  // gutter together.
  // shortcut: the line height is worked out, not read, and assumes a 2x display; if marks
  // drift, turn `gutter` off in mod.json until Herdr's editor can draw them itself.
  codeWithGutter() {
    const t = theme();
    const lines = (this.text ?? "").split("\n").length;
    const height = lineHeight();
    const COLORS = { added: t.ansi2, changed: t.ansi3, removed: t.ansi1 };
    const marks = (this.hunks ?? []).map((hunk, i) =>
      div()
        .id(`viewer-mark-${i}`)
        .absolute()
        .left(0)
        .w(GUTTER_WIDTH)
        .top(hunk.line * height)
        .h(hunk.kind === "removed" ? 2 : Math.min(hunk.count, lines - hunk.line) * height)
        .bg(COLORS[hunk.kind]),
    );
    return v_flex()
      .id("viewer-scroll")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .flex_none()
          .w_full()
          .h(lines * height + END_ROOM)
          .items_start()
          .child(div().relative().w(GUTTER_WIDTH + 2).flex_none().h(lines * height).children(marks))
          .child(Editor.new(this.code).flex_1().min_w(0).h(lines * height + END_ROOM)),
      );
  },

  viewerActions() {
    const file = this.file;
    const preview = this.viewerEntry()?.preview;
    const editors = file?.on ? [] : foundEditors();
    return h_flex()
      .id("viewer-actions")
      .gap(6)
      .items_center()
      .when(Boolean(preview), (el) =>
        el.child(
          TextButton({
            id: "viewer-keep",
            label: "Keep tab",
            onClick: (cx) => {
              this.setViewer(this.viewerId, { preview: false });
              cx.notify();
            },
          }),
        ),
      )
      .when(editors.length > 0, (el) =>
        el.child(
          this.chooser({
            id: "viewer-open-in",
            accessibilityLabel: "Open in an editor",
            width: 200,
            trigger: MenuButton({ id: "viewer-open-in-trigger", label: "Open in" }),
            choices: editors.map((e) => ({ id: e.bundle, label: e.name })),
            onChoose: (bundle) => {
              this.openInEditor(editors.find((e) => e.bundle === bundle), file.path);
            },
          }),
        ),
      );
  },

  viewerView() {
    const t = theme();
    const head = this.viewerHead();
    const inHeader = this.headerShowsTitle();
    const root = v_flex()
      .id("better-files-viewer")
      .relative()
      .size_full()
      .min_w(0)
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(TEXT.body);
    if (!inHeader && head)
      root.child(
        h_flex()
          .id("viewer-bar")
          .h(30)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .text_size(TEXT.small)
          .child(Icon("file", 14).text_color(t.dim))
          .child(div().flex_none().truncate().max_w(260).font_medium().child(head.title))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(head.detail))
          .child(this.viewerActions()),
      );
    if (this.problem) root.child(Message(this.problem));
    else if (!this.code) root.child(Message(head ? "Loading…" : "This tab has no file."));
    else if (this.gutterOn) root.child(this.codeWithGutter());
    else root.child(v_flex().flex_1().min_h(0).child(Editor.new(this.code).flex_1().min_h(0)));
    // There's no row of its own to sit in, so the actions float over the file's corner.
    if (inHeader) root.child(div().absolute().top(6).right(18).child(this.viewerActions()));
    return root;
  },
};
