// A file in the centre pane, read-only, following the file as it changes on disk. Editing
// belongs in the code editor it can open.
import { div, image } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, Scrollbar, v_virtual_list } from "gpui-base";
import { appHome, exec, focused, layout, panes, readTextFile, setShared, shared, theme } from "herdr";
import { baseName, isImage, languageOf, lineMarks, parseHunks, tokenize, viewable } from "../files/model.js";
import { viewerEntries } from "../actions/open.js";
import { foundEditors } from "../actions/outside.js";
import { TEXT, Icon, Message, MenuButton, TextButton, codeFont, codeSize } from "./ui.js";

const CHAR_WIDTH = 0.62; // Of the code font's size, to size the sideways scroll.
const LINE_COLUMNS = 6; // The number column and a margin, in the same units.
const rowHeight = () => Math.round(codeSize() * 1.6);

// $1 the file, $2 its copy, $3 the copy of what this tab showed before. No file name reaches
// the script itself, and only the cache's own copies are ever removed.
const COPY_IMAGE = `[ -z "$3" ] || rm -f -- "$3"; mkdir -p -- "$(dirname -- "$2")" && { cmp -s -- "$1" "$2" || cp -- "$1" "$2"; }`;

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
    if (!file || !this.gutterOn || this.diffing || isImage(file.path)) return;
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
    if (file && isImage(file.path)) return this.readImage(cx);
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
        if (!this.gutterOn) {
          if (this.code) this.code.set_value(shown.text);
          else this.code = this.newCode(file, shown.text);
        }
      }
      cx.notify();
    });
  },

  newCode(file, value) {
    const t = theme();
    return EditorState.new({
      language: languageOf(file.path),
      readonly: true,
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

  // The file as rows, the way Better Changes draws a diff. Herdr's editor can't mark a line,
  // and marks laid over it slid as it scrolled, but here a line's colour is part of its row.
  linesView() {
    const lines = this.fileLines();
    const language = languageOf(this.file.path);
    const marks = lineMarks(this.hunks ?? [], lines.length);
    const height = rowHeight();
    const listId = `viewer-lines-${this.viewerId}-${this.file.path}`;
    const list = v_virtual_list(
      listId,
      lines.length,
      height,
      (i) => String(i),
      (range) => {
        const rows = [];
        for (let i = range.start; i < range.end; i++)
          rows.push(this.lineRow(i, lines[i], language, marks, height, lines.length));
        return rows;
      },
    ).size_full();
    const widest = lines.reduce((most, line) => Math.max(most, line.length), 0);
    return div()
      .id("viewer-lines")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .relative()
      .font_family(codeFont())
      .text_size(codeSize())
      .child(
        div()
          .id("viewer-x")
          .size_full()
          .overflow_x_scrollbar()
          .child(
            div()
              .w_full()
              .min_w(Math.max(300, (widest * CHAR_WIDTH + LINE_COLUMNS) * codeSize()))
              .h_full()
              .child(list),
          ),
      )
      .child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
  },

  // Split once per version of the file: rows are drawn on every scroll.
  fileLines() {
    if (this.linesOf !== this.text) {
      this.linesOf = this.text;
      this.lines = (this.text ?? "").split("\n").map((line) => line.replace(/\r$/, "").replace(/\t/g, "    "));
    }
    return this.lines;
  },

  lineRow(i, line, language, marks, height, count) {
    const t = theme();
    const COLORS = { added: t.ansi2, changed: t.ansi3 };
    const SYNTAX = { keyword: t.ansi5, string: t.ansi2, comment: t.dim, number: t.ansi1 };
    const kind = marks.kinds.get(i);
    const removed = (at) => div().id(`viewer-removed-${at}`).absolute().left(0).right(0).h(2).bg(t.ansi1);
    const row = h_flex()
      .id(`viewer-line-${i}`)
      .relative()
      .h(height)
      .w_full()
      .items_center()
      .when(Boolean(kind), (el) => el.bg(`${COLORS[kind]?.slice(0, 7)}26`))
      .child(
        div()
          .id(kind ? `viewer-mark-${i}` : `viewer-bar-${i}`)
          .w(3)
          .h_full()
          .flex_none()
          .when(Boolean(kind), (el) => el.bg(COLORS[kind])),
      )
      .child(
        div()
          .w(codeSize() * 3.5)
          .pr(codeSize())
          .flex_none()
          .text_right()
          .text_color(t.dim)
          .child(String(i + 1)),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .whitespace_nowrap()
          .children(
            tokenize(line, language).map((run) =>
              div()
                .flex_none()
                .whitespace_nowrap()
                .text_color(SYNTAX[run.kind] ?? t.foreground)
                .child(run.text || " "),
            ),
          ),
      );
    if (marks.removedAbove.has(i)) row.child(removed(i).top(0));
    if (i === count - 1 && marks.removedAbove.has(count)) row.child(removed(count).bottom(0));
    return row;
  },

  // Herdr only loads images from under its own folder, so the file is shown through a copy
  // in this mod's cache. Saving over the copy updates what's on screen, which is how a
  // changed image refreshes. Each file a tab shows gets its own name, for the same reason.
  readImage(cx) {
    const file = this.file;
    if (file.on || this.reading) return;
    if (this.imageFor !== file.path) {
      this.imageFor = file.path;
      this.imageSerial = (this.imageSerial ?? 0) + 1;
      this.imageOld = this.imageCopy;
      const ext = file.path.split(".").pop().toLowerCase();
      this.imageCopy = `mods/better-files/cache/${this.viewerId}-${this.imageSerial}.${ext}`;
      this.imageShown = null;
    }
    const copy = this.imageCopy;
    const old = this.imageOld ? `${appHome()}/${this.imageOld}` : "";
    this.imageOld = null;
    this.reading = true;
    cx.spawn(async (cx) => {
      const result = await exec(
        "sh",
        ["-c", COPY_IMAGE, "copy-image", file.path, `${appHome()}/${copy}`, old],
        {},
      ).catch(() => null);
      this.reading = false;
      if (this.file?.path !== file.path) return;
      const problem = result?.code === 0 ? null : "This file is no longer available.";
      const shown = problem ? null : copy;
      if (problem !== this.problem || shown !== this.imageShown) {
        this.problem = problem;
        this.imageShown = shown;
        cx.notify();
      }
    });
  },

  // Another machine's file isn't on this one to load.
  imageView() {
    if (this.file.on) return Message("Images on another machine can't be shown here.");
    if (this.problem) return Message(this.problem);
    if (!this.imageShown) return Message("Loading…");
    return h_flex()
      .id("viewer-image")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .p(16)
      .child(image(this.imageShown).flex_1().min_w(0).h_full());
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
    if (this.file && isImage(this.file.path)) root.child(this.imageView());
    else if (this.problem) root.child(Message(this.problem));
    else if (this.text === undefined) root.child(Message(head ? "Loading…" : "This tab has no file."));
    else if (this.gutterOn) root.child(this.linesView());
    else root.child(v_flex().flex_1().min_h(0).child(Editor.new(this.code).flex_1().min_h(0)));
    // There's no row of its own to sit in, so the actions float over the file's corner.
    if (inHeader) root.child(div().absolute().top(6).right(18).child(this.viewerActions()));
    return root;
  },
};
