// Sidebar status/commit controls and a reusable diff-tab view share this class.
// Pure Git-output parsing and diff-row transformations live in model.js.
import { em, codeFont } from "./typography.js";
import { changedFiles, fileTree, diffRows, splitDiffRows } from "./model.js";
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import {
  spaces,
  panes,
  focused,
  exec,
  readTextFile,
  watchFolder,
  theme,
  props,
  shared,
  setShared,
  run,
  layout,
  nextCommand,
} from "herdr";

// Status polling must not take optional index locks or trigger filesystem-monitor
// helpers. Diff reads also disable external diff/textconv helpers at the call site.
const READ_ONLY_GIT_OPTIONS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.autoRefreshIndex=false",
];
const MAX_FILES = 1000;
const MAX_DIFF_LINES = 1500;
const MAX_LINE_LENGTH = 4000;
const CONTEXT_POLL_MS = 300;
const STATUS_POLL_MS = 10000;
const TAB_OPEN_TIMEOUT_MS = 1500;

// Follow the active terminal unless the active tab is our diff viewer. Mod panes
// have no terminal cwd, so that case must use the repository saved for the tab.
function location() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs?.find((t) => t.active)?.id;
  const candidates = panes().filter((p) => p.tab === tab && p.cwd);
  if (!candidates.length && panes().some((p) => p.tab === tab && p.mod === "better-changes")) {
    const source = (shared("better-changes.diff-tabs") ?? {})[space?.id]?.source;
    if (source) return source;
  }
  return {
    cwd:
      candidates.find((p) => p.focused)?.cwd ??
      candidates[0]?.cwd ??
      focused()?.cwd ??
      space?.folder,
    on: space?.machine ?? null,
  };
}

// One View class serves two roles: a sidebar and a regular diff tab. Each copy
// owns its local state; shared("better-changes.*") connects the separate copies.
export default class Changes extends View {
  // ── Lifecycle and cross-view synchronization ──────────────────────────────

  init(_props, cx) {
    this.mode = props()?.mode ?? _props?.mode ?? "sidebar";
    this.diffSpace = props()?.space ?? _props?.space;
    this.source = props()?.source ?? _props?.source;
    this.restoreDiffSelection(_props);
    this.view = localStorage.getItem("better-changes.view") === "flat" ? "flat" : "tree";
    this.diffLayout =
      shared("better-changes.diff-layout") ??
      (localStorage.getItem("better-changes.diff-layout") === "split" ? "split" : "inline");
    if (this.mode === "sidebar" || !shared("better-changes.diff-layout"))
      setShared("better-changes.diff-layout", this.diffLayout);
    // Local display state. Collapsed folders use "scope:path" keys so staged
    // and unstaged groups can collapse the same directory independently.
    this.splitOffset = 0;
    this.closed = new Set();
    this.files = [];
    this.rows = [];
    this.diffToken = 0; // Monotonically increasing ID for async preview requests.
    this.message = "";
    this.input = InputState.new({ placeholder: "Commit message…" });
    this.input.on("change", (_e, cx) => {
      this.message = this.input.value();
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.startPolling(cx);
    this.listenForCommands(cx);
    this.refresh(cx);
  }

  // A reopened diff tab can restore its selection from local storage. Never
  // replace an existing shared entry: it may contain a more recent file pick.
  restoreDiffSelection(_props) {
    if (this.mode === "diff" && this.diffSpace) {
      const entries = shared("better-changes.diff-tabs") ?? {};
      if (!entries[this.diffSpace]) {
        let selected = props()?.selection ?? _props?.selection;
        let source = this.source;
        try {
          const saved = JSON.parse(localStorage.getItem("diff.selection"));
          if (typeof saved?.path === "string" && typeof JSON.parse(saved.context)?.cwd === "string")
            selected = saved;
        } catch {
          // Missing or malformed saved state is harmless; use the supplied props.
        }
        try {
          if (selected) source = JSON.parse(selected.context);
        } catch {
          selected = null;
        }
        setShared("better-changes.diff-tabs", {
          ...entries,
          [this.diffSpace]: { source, selection: selected },
        });
      }
    }
  }

  // Context changes need a quick response; full Git status reads are slower.
  // Remote repositories rely on polling because watchFolder is local-only.
  startPolling(cx) {
    cx.timer.every(CONTEXT_POLL_MS, (cx) => {
      const style = shared("better-changes.diff-layout");
      if (style && style !== this.diffLayout) {
        this.diffLayout = style;
        localStorage.setItem("better-changes.diff-layout", style);
        cx.notify();
      }
      if (this.contextKey() !== this.context) this.refresh(cx);
      if (this.mode === "diff") this.syncSelection(cx);
      const reload = shared("better-changes.reload");
      if (
        reload &&
        reload.at !== this.reload &&
        reload.root === this.root &&
        reload.on === (this.on ?? null) &&
        !this.loading &&
        !this.busy
      ) {
        this.reload = reload.at;
        this.refresh(cx);
      }
    });
    cx.timer.every(STATUS_POLL_MS, (cx) => this.refresh(cx));
  }

  listenForCommands(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "diff-inline" || command === "diff-split")
          this.setDiffLayout(command.slice(5), cx);
        if (command.startsWith("open:")) {
          const file = this.files.find((f) => f.path === command.slice(5));
          if (file) this.pick(file, cx);
        }
      }
    });
  }

  // ── Repository context and status ─────────────────────────────────────────

  location() {
    return this.mode === "diff"
      ? ((shared("better-changes.diff-tabs") ?? {})[this.diffSpace]?.source ??
          this.source ??
          location())
      : (this.source ?? location());
  }

  // Include both cwd and machine: identical paths on different machines are
  // different repositories. Async reads compare this key before publishing.
  contextKey() {
    return JSON.stringify(this.location());
  }

  currentSelection() {
    return this.mode === "diff"
      ? ((shared("better-changes.diff-tabs") ?? {})[this.diffSpace]?.selection ??
          shared("better-changes.selection"))
      : shared("better-changes.selection");
  }

  diffTab(space = this.diffSpace) {
    const target = spaces().find((s) => s.id === space);
    const ids = new Set((target?.tabs ?? []).map((t) => t.id));
    return panes().find((p) => p.mod === "better-changes" && ids.has(p.tab))?.tab;
  }

  git(args, root = this.root, on = this.on) {
    return exec("git", [...READ_ONLY_GIT_OPTIONS, ...args], { cwd: root, on });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = this.location();
    const context = this.contextKey();
    // Clear every repository-specific field before loading the new context.
    // Incrementing diffToken invalidates previews still in flight.
    if (context !== this.context) {
      this.context = context;
      this.root = null;
      this.files = [];
      this.path = null;
      this.rows = [];
      this.closed = new Set();
      this.diffToken++;
      this.selection = null;
      this.diffLoading = false;
      this.error = null;
      this.note = null;
      this.watched = null;
      this.message = "";
      this.input.set_value("");
    }
    if (!cwd) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const top = await this.git(["rev-parse", "--show-toplevel"], cwd, on);
        if (context !== this.contextKey()) return;
        if (top.code !== 0) {
          this.root = null;
          this.files = [];
          this.rows = [];
          this.error = "Not a Git repository";
          return;
        }
        const root = top.stdout.trim();
        const git = (args) => this.git(args, root, on);
        const status = await git([
          "status",
          "--porcelain=v1",
          "-z",
          "--no-renames",
          "--untracked-files=all",
        ]);
        if (status.code !== 0) throw Error(status.stderr || "Cannot read changes");
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const hasHead = head.code === 0;
        const statArgs = ["--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"];
        const stats = [
          await git(["diff", "--cached", ...statArgs]),
          await git(["diff", ...statArgs]),
        ];
        for (const stat of stats)
          if (stat.code !== 0) throw Error(stat.stderr || "Cannot read change statistics");
        if (context !== this.contextKey()) return;
        const files = changedFiles(
          status.stdout,
          stats.map((r) => r.stdout),
        );
        this.root = root;
        this.on = on;
        this.hasHead = hasHead;
        this.total = files.length;
        this.stagedCount = files.filter((f) => f.staged).length;
        this.unstagedCount = files.filter((f) => f.unstaged).length;
        this.conflicts = files.some((f) => f.conflict);
        this.files = files.slice(0, MAX_FILES);
        this.error = null;
        this.watch(root, cx);
        if (this.mode === "diff") {
          this.syncSelection(cx);
          if (this.path && !this.diffLoading) this.loadDiff(cx);
        }
      } catch (error) {
        if (context === this.contextKey()) this.error = error.message;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch {
        if (this.watched === root) this.watched = null;
      }
    });
  }
  // ── File selection and reusable diff tabs ─────────────────────────────────

  pick(file, cx, scope = "all") {
    const space = spaces().find((s) => s.active);
    if (!space) return;
    const selected = {
      context: this.context,
      root: this.root,
      on: this.on,
      path: file.path,
      scope,
      at: Date.now(),
    };
    const entries = shared("better-changes.diff-tabs") ?? {};
    const old = entries[space.id];
    const tab = this.diffTab(space.id);
    const source = JSON.parse(this.context);
    const name = file.path.split("/").pop();
    // Publish before opening/selecting the tab so its View sees the latest pick.
    // A pending timestamp prevents rapid clicks from creating duplicate tabs.
    setShared("better-changes.selection", selected);
    setShared("better-changes.diff-tabs", {
      ...entries,
      [space.id]: {
        source,
        selection: selected,
        pending: tab ? null : (old?.pending ?? Date.now()),
      },
    });
    if (tab) {
      run("tab.rename", { id: tab, name });
      run("tab.select", { id: tab });
    } else if (!old?.pending || Date.now() - old.pending > TAB_OPEN_TIMEOUT_MS) {
      run("tab.new", {
        space: space.id,
        name,
        mod: "better-changes",
        props: { mode: "diff", space: space.id, source, selection: selected },
      });
    }
    // Layouts with an optional center stack (such as Factory) need their tab view
    // revealed. Ordinary Herdr layouts already show the selected tab directly.
    const find = (node) =>
      node?.id === "center-body" ? node : (node?.children ?? []).map(find).find(Boolean);
    const center = find(layout());
    if (center?.type === "stack" && center.children?.some((child) => child.id === "main"))
      run("layout.select", { stack: center.id, child: "main" });
    cx.notify();
  }

  syncSelection(cx) {
    const selected = this.currentSelection();
    if (!selected || selected.context !== this.context) {
      if (this.path) {
        this.path = null;
        this.rows = [];
        this.diffToken++;
        this.diffLoading = false;
        cx.notify();
      }
      return;
    }
    const id = JSON.stringify(selected);
    if (id === this.selection) return;
    localStorage.setItem("diff.selection", JSON.stringify(selected));
    const tab = this.diffTab();
    if (tab) {
      const name = selected.path.split("/").pop();
      const live = spaces()
        .find((s) => s.id === this.diffSpace)
        ?.tabs?.find((t) => t.id === tab);
      if (live?.name !== name) run("tab.rename", { id: tab, name });
      const entries = shared("better-changes.diff-tabs") ?? {};
      if (entries[this.diffSpace]?.pending)
        setShared("better-changes.diff-tabs", {
          ...entries,
          [this.diffSpace]: { ...entries[this.diffSpace], pending: null },
        });
    }
    this.splitOffset = 0;
    this.selection = id;
    this.path = selected.path;
    this.scope = selected.scope || "all";
    this.rows = [];
    this.note = null;
    this.diffToken++;
    this.diffLoading = false;
    if (this.root) this.loadDiff(cx);
    cx.notify();
  }
  // ── Read-only diff loading ────────────────────────────────────────────────

  loadDiff(cx) {
    const path = this.path;
    const context = this.context;
    const root = this.root;
    const on = this.on;
    const hasHead = this.hasHead;
    const scope = this.scope || "all";
    const file = this.files.find((f) => f.path === path);
    const token = ++this.diffToken;
    this.note = null;
    if (!file) {
      this.rows = [];
      this.note = "This file has no remaining changes, or is outside the first 1,000 listed files.";
      this.diffLoading = false;
      cx.notify();
      return;
    }
    if ((scope === "staged" && !file.staged) || (scope === "unstaged" && !file.unstaged)) {
      this.rows = [];
      this.note = `No ${scope} changes remain for this file.`;
      this.diffLoading = false;
      cx.notify();
      return;
    }
    this.diffLoading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        let lines;
        // Untracked files (and all-changes previews before the first commit)
        // have no HEAD version to diff against. Build an all-additions hunk.
        if (file.fresh || (!hasHead && file.status === "A" && scope === "all")) {
          const text = await readTextFile(`${root}/${path}`, { on });
          if (text === null)
            lines = ["Cannot preview this file: binary, too large, or unreadable."];
          else if (text.includes("\0")) lines = ["Binary file · no text diff"];
          else if (!text) lines = ["Empty new file"];
          else {
            const all = text.replace(/\n$/, "").split("\n");
            file.add = all.length;
            lines = [`@@ -0,0 +1,${all.length} @@`, ...all.map((line) => `+${line}`)];
          }
        } else {
          // `--` separates paths from options, but still allows Git patterns.
          // Treat the selected filename literally, just like index mutations.
          const result = await this.git(
            [
              "--literal-pathspecs",
              "diff",
              ...(scope === "staged"
                ? ["--cached"]
                : scope === "unstaged"
                  ? []
                  : hasHead
                    ? ["HEAD"]
                    : []),
              "--no-ext-diff",
              "--no-textconv",
              "--no-color",
              "--",
              path,
            ],
            root,
            on,
          );
          if (result.code !== 0) throw Error(result.stderr || "Cannot read diff");
          const all = result.stdout.replace(/\n$/, "").split("\n");
          const first = all.findIndex((line) => line.startsWith("@@"));
          lines =
            first < 0
              ? [
                  file.binary
                    ? "Binary file changed"
                    : "No text diff available (mode-only or submodule change)",
                ]
              : all.slice(first);
        }
        // A later click or repository switch may have overtaken this request.
        if (token !== this.diffToken || context !== this.contextKey()) return;
        this.truncated =
          lines.length > MAX_DIFF_LINES || lines.some((line) => line.length > MAX_LINE_LENGTH);
        const visible = lines
          .slice(0, MAX_DIFF_LINES)
          .map((line) =>
            line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "…" : line,
          );
        this.rows = diffRows(visible);
        this.width = Math.max(300, ...visible.map((line) => line.length * em(0.7) + 110));
      } catch (error) {
        if (token === this.diffToken && context === this.contextKey()) {
          this.rows = [];
          this.note = error.message;
        }
      } finally {
        if (token === this.diffToken) {
          this.diffLoading = false;
          cx.notify();
        }
      }
    });
  }
  // ── Git mutations (sidebar only) ──────────────────────────────────────────

  // Never reset working files. Unstage changes only the index; before the first
  // commit there is no HEAD, so remove index entries with git rm --cached.
  // Literal pathspecs keep names such as [sample].txt from acting as patterns.
  indexAction(action, path, cx) {
    if (
      !this.root ||
      this.loading ||
      this.busy ||
      this.contextKey() !== this.context ||
      this.mode !== "sidebar"
    )
      return;
    if (
      path &&
      !this.files.some((f) => f.path === path && (action === "stage" ? f.unstaged : f.staged))
    )
      return;
    const root = this.root;
    const on = this.on;
    const context = this.context;
    let args;
    if (action === "stage")
      args = path ? ["--literal-pathspecs", "add", "--", path] : ["add", "-A"];
    else if (action === "unstage")
      args = this.hasHead
        ? ["--literal-pathspecs", "reset", "-q", "HEAD", "--", path || "."]
        : ["--literal-pathspecs", "rm", "--cached", "-r", "-f", "--", path || "."];
    else return;
    this.busy = true;
    this.operation = action;
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await this.git(args, root, on);
        if (result.code !== 0) throw Error((result.stderr || result.stdout).trim());
        const at = Date.now();
        this.reload = at;
        setShared("better-changes.reload", { root, on: on ?? null, at });
      } catch (error) {
        if (context === this.contextKey())
          this.note = `${action === "stage" ? "Stage" : "Unstage"} failed: ${error.message}`;
      } finally {
        this.busy = false;
        this.operation = null;
        this.refresh(cx);
        cx.notify();
      }
    });
  }

  // Commit the existing index, not all working-tree edits. On failure, keep the
  // message so the user can fix the problem and retry without retyping it.
  commit(cx) {
    if (
      !this.message.trim() ||
      !this.root ||
      this.loading ||
      this.busy ||
      this.contextKey() !== this.context ||
      !this.stagedCount ||
      this.conflicts ||
      this.mode !== "sidebar"
    )
      return;
    const root = this.root;
    const on = this.on;
    const context = this.context;
    const message = this.message.trim();
    this.busy = true;
    this.operation = "commit";
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await this.git(["commit", "-m", message], root, on);
        if (result.code !== 0) throw Error((result.stderr || result.stdout).trim());
        const at = Date.now();
        this.reload = at;
        setShared("better-changes.reload", { root, on: on ?? null, at });
        if (context === this.contextKey()) {
          this.message = "";
          this.input.set_value("");
        }
      } catch (error) {
        if (context === this.contextKey()) this.note = `Commit failed: ${error.message}`;
      } finally {
        this.busy = false;
        this.operation = null;
        this.refresh(cx);
        cx.notify();
      }
    });
  }
  // ── Shared controls and file rows ─────────────────────────────────────────

  icon(id, asset, label, action, t, active = false, disabled = false, size = 24) {
    return div()
      .id(id)
      .size(size)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(5)
      .border_1()
      .border_color(active ? t.accent : t.border)
      .bg(active ? t.selected : t.raised)
      .text_color(disabled ? t.dim : active ? t.accent : t.muted)
      .tooltip(label)
      .accessibility_label(label)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(!disabled, (el) =>
        el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)),
      )
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!disabled) action(cx);
      })
      .child(svg(`mods/better-changes/${asset}.svg`).size(size <= 22 ? 12 : 14));
  }

  fileRow(file, depth, t, scope = "all") {
    const flat = this.view === "flat";
    const parts = file.path.split("/");
    const name = parts.pop();
    const selected = this.currentSelection();
    return h_flex()
      .id(`change-${scope}-${file.path}`)
      .h(30)
      .flex_none()
      .pl(8 + depth * 14)
      .pr(8)
      .gap(7)
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .when(
        selected?.context === this.context &&
          selected?.path === file.path &&
          (selected.scope || "all") === scope,
        (el) => el.bg(t.selected),
      )
      .hover((s) => s.bg(t.hover))
      .tooltip(file.path)
      .on_click((_e, cx) => this.pick(file, cx, scope))
      .child(svg("mods/better-changes/file.svg").size(13).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(name))
      .when(flat && parts.length > 0, (el) =>
        el.child(
          div().max_w(110).truncate().text_size(em(0.8)).text_color(t.dim).child(parts.join("/")),
        ),
      )
      .when(file.add > 0, (el) =>
        el.child(div().text_size(em(0.8)).text_color(t.ansi2).child(`+${file.add}`)),
      )
      .when(file.del > 0, (el) =>
        el.child(div().text_size(em(0.8)).text_color(t.ansi1).child(`−${file.del}`)),
      )
      .child(
        div()
          .w(13)
          .text_size(em(0.8))
          .text_color(
            file.status === "A"
              ? t.ansi2
              : file.status === "D" || file.status === "U"
                ? t.ansi1
                : t.blocked,
          )
          .child(file.status),
      )
      .when(scope !== "all", (el) =>
        el.child(
          this.icon(
            `changes-${scope === "staged" ? "unstage" : "stage"}-${file.path}`,
            scope === "staged" ? "unstage" : "stage",
            scope === "staged" ? "Unstage file" : "Stage file",
            (cx) => this.indexAction(scope === "staged" ? "unstage" : "stage", file.path, cx),
            t,
            false,
            this.busy || this.loading,
            20,
          ),
        ),
      );
  }

  setDiffLayout(style, cx) {
    if (!["inline", "split"].includes(style)) return;
    this.diffLayout = style;
    localStorage.setItem("better-changes.diff-layout", style);
    setShared("better-changes.diff-layout", style);
    cx.notify();
  }

  diffLayoutToggle(t) {
    const row = h_flex()
      .id("changes-diff-layout")
      .p(2)
      .gap(2)
      .items_center()
      .flex_none()
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.raised);
    for (const [style, label] of [
      ["inline", "Inline diff"],
      ["split", "Side-by-side diff"],
    ]) {
      const active = this.diffLayout === style;
      row.child(
        div()
          .id(`changes-diff-${style}`)
          .size(22)
          .flex()
          .items_center()
          .justify_center()
          .rounded(5)
          .bg(active ? t.selected : t.raised)
          .text_color(active ? t.accent : t.muted)
          .cursor_pointer()
          .tooltip(label)
          .accessibility_label(label)
          .hover((el) => el.bg(active ? t.selected : t.hover))
          .on_click((_e, cx) => this.setDiffLayout(style, cx))
          .child(svg(`mods/better-changes/diff-${style}.svg`).size(13)),
      );
    }
    return row;
  }
  // ── Sidebar rendering ────────────────────────────────────────────────────

  render() {
    const t = theme();
    const root = v_flex()
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(em(1));
    if (this.mode === "diff") return this.renderDiff(root, t);
    root.child(this.renderSidebarHeader(t));
    root.child(this.renderFileList(t));
    if (this.error && this.files.length)
      root.child(div().px(12).py(6).text_color(t.ansi1).child(this.error));
    if (this.note) root.child(div().px(12).py(6).text_color(t.ansi1).child(this.note));
    root.child(this.renderCommitFooter(t));
    return root;
  }

  renderSidebarHeader(t) {
    const head = h_flex()
      .h(44)
      .px(12)
      .gap(6)
      .flex_none()
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().font_semibold().child("Changes"))
      .child(
        div()
          .text_size(em(0.8))
          .text_color(t.dim)
          .child(String(this.total ?? 0)),
      )
      .child(div().flex_1());
    head.child(this.diffLayoutToggle(t));
    const fileViews = h_flex()
      .id("changes-file-view")
      .p(2)
      .gap(2)
      .items_center()
      .flex_none()
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.raised);
    for (const view of ["tree", "flat"]) {
      const active = this.view === view;
      const label = view === "tree" ? "Tree view" : "Flat view";
      fileViews.child(
        div()
          .id(`changes-${view}`)
          .size(22)
          .flex()
          .items_center()
          .justify_center()
          .rounded(5)
          .bg(active ? t.selected : t.raised)
          .text_color(active ? t.accent : t.muted)
          .cursor_pointer()
          .tooltip(label)
          .accessibility_label(label)
          .hover((el) => el.bg(active ? t.selected : t.hover))
          .on_click((_e, cx) => {
            this.view = view;
            localStorage.setItem("better-changes.view", view);
            cx.notify();
          })
          .child(svg(`mods/better-changes/${view}.svg`).size(13)),
      );
    }
    head.child(fileViews);
    head.child(
      this.icon("changes-refresh", "refresh", "Refresh changes", (cx) => this.refresh(cx), t),
    );
    return head;
  }

  renderFileList(t) {
    const list = v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar().p(6);
    for (const [scope, label, count] of [
      ["staged", "Staged", this.stagedCount ?? 0],
      ["unstaged", "Unstaged", this.unstagedCount ?? 0],
    ]) {
      const isStaged = scope === "staged";
      const action = isStaged ? "unstage" : "stage";
      // A partially staged file appears twice. Render each group's own status
      // and line counts rather than the totals across index and working tree.
      const group = this.files
        .filter((file) => (isStaged ? file.staged : file.unstaged))
        .map((file) => ({
          ...file,
          status: (isStaged ? file.stagedStatus : file.unstagedStatus) || file.status,
          ...(isStaged ? file.stagedStats : file.unstagedStats),
        }));
      list.child(
        h_flex()
          .id(`changes-section-${scope}`)
          .h(34)
          .px(8)
          .gap(6)
          .items_center()
          .flex_none()
          .child(div().font_semibold().text_size(em(0.9)).child(label))
          .child(div().text_size(em(0.8)).text_color(t.dim).child(String(count)))
          .child(div().flex_1())
          .child(
            this.icon(
              `changes-${action}-all`,
              action,
              isStaged ? "Unstage all" : "Stage all",
              (cx) => this.indexAction(action, null, cx),
              t,
              false,
              !count || this.busy || this.loading,
              22,
            ),
          ),
      );
      if (!group.length) {
        list.child(
          div()
            .px(8)
            .pb(6)
            .text_size(em(0.85))
            .text_color(t.dim)
            .child(scope === "staged" ? "No staged changes" : "No unstaged changes"),
        );
        continue;
      }
      if (this.view === "flat") list.children(group.map((file) => this.fileRow(file, 0, t, scope)));
      else
        for (const row of fileTree(
          group,
          new Set(
            [...this.closed]
              .filter((k) => k.startsWith(scope + ":"))
              .map((k) => k.slice(scope.length + 1)),
          ),
        )) {
          if (row.kind === "file") list.child(this.fileRow(row.file, row.depth, t, scope));
          else {
            list.child(this.folderRow(row, scope, t));
          }
        }
    }
    if (!this.files.length)
      list.child(
        div()
          .p(10)
          .text_color(t.dim)
          .child(
            this.error ||
              (this.loading
                ? "Loading changes…"
                : this.root
                  ? "No uncommitted changes"
                  : "No folder selected"),
          ),
      );
    return list;
  }

  folderRow(row, scope, t) {
    const closedKey = `${scope}:${row.path}`;
    const chevron = this.closed.has(closedKey) ? "chevron-right" : "chevron-down";
    return h_flex()
      .id(`changes-folder-${scope}-${row.path}`)
      .h(28)
      .pl(8 + row.depth * 14)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.closed.has(closedKey)) this.closed.delete(closedKey);
        else this.closed.add(closedKey);
        cx.notify();
      })
      .child(svg(`mods/better-changes/${chevron}.svg`).size(10).text_color(t.dim))
      .child(svg("mods/better-changes/folder.svg").size(13).text_color(t.muted))
      .child(div().min_w(0).truncate().child(row.name));
  }

  renderCommitFooter(t) {
    const enabled = Boolean(
      this.message.trim() &&
      this.root &&
      !this.busy &&
      !this.loading &&
      this.stagedCount &&
      !this.conflicts,
    );
    return v_flex()
      .p(10)
      .gap(8)
      .flex_none()
      .border_t(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(
            Input.new(this.input)
              .id("changes-commit-message")
              .h(28)
              .flex_1()
              .min_w(0)
              .px(8)
              .rounded(5)
              .border_1()
              .border_color(t.border)
              .bg(t.input)
              .text_size(em(0.9)),
          )
          .child(
            div()
              .id("changes-commit")
              .tooltip("Commit staged changes only")
              .h(28)
              .px(8)
              .flex()
              .gap(5)
              .items_center()
              .rounded(5)
              .border_1()
              .border_color(t.border)
              .bg(enabled ? t.solid : t.raised)
              .text_color(enabled ? t.solid_foreground : t.dim)
              .text_size(em(0.85))
              .when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => this.commit(cx)))
              .child(svg("mods/better-changes/commit.svg").size(14))
              .child(this.operation === "commit" ? "Committing…" : "Commit staged"),
          ),
      )
      .child(
        div()
          .text_size(em(0.8))
          .text_color(t.dim)
          .child(
            this.total > MAX_FILES
              ? "First 1,000 files shown"
              : this.conflicts
                ? "Resolve conflicts and stage the files before committing"
                : "Commit includes staged changes only",
          ),
      );
  }

  // ── Diff rendering (inline and side-by-side) ───────────────────────────────

  renderDiff(root, t) {
    const original = this.files.find((f) => f.path === this.path);
    const file = original
      ? {
          ...original,
          ...(this.scope === "staged"
            ? original.stagedStats
            : this.scope === "unstaged"
              ? original.unstagedStats
              : {}),
        }
      : null;
    const head = h_flex()
      .min_h(46)
      .px(14)
      .py(8)
      .gap(8)
      .items_center()
      .flex_none()
      .border_b(1)
      .border_color(t.border)
      .child(svg("mods/better-changes/file.svg").size(15).text_color(t.muted))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .whitespace_normal()
          .font_semibold()
          .child(this.path || "File diff"),
      );
    if (file)
      head
        .child(div().text_size(em(0.85)).text_color(t.ansi2).child(`+${file.add}`))
        .child(div().text_size(em(0.85)).text_color(t.ansi1).child(`−${file.del}`));
    head
      .child(this.icon("diff-refresh", "refresh", "Refresh diff", (cx) => this.refresh(cx), t))
      .child(
        this.icon(
          "diff-close",
          "close",
          "Close diff",
          () => {
            const tab = this.diffTab();
            if (tab) run("tab.close", { id: tab });
          },
          t,
        ),
      );
    root.child(head);
    root.child(
      h_flex()
        .h(30)
        .px(14)
        .gap(10)
        .items_center()
        .flex_none()
        .text_size(em(0.8))
        .text_color(t.dim)
        .child(
          div()
            .flex_1()
            .truncate()
            .child(
              `${this.scope === "staged" ? "Staged · HEAD → Index" : this.scope === "unstaged" ? "Unstaged · Index → Working tree" : "All changes"} · ${this.root || ""}`,
            ),
        )
        .child(div().text_color(t.ansi2).child("+ Added"))
        .child(div().text_color(t.ansi1).child("− Removed")),
    );
    if (this.diffLoading && !this.rows.length)
      root.child(div().p(14).text_color(t.dim).child("Loading diff…"));
    if (this.error || this.note)
      root.child(
        div()
          .px(14)
          .py(8)
          .text_color(t.ansi1)
          .child(this.error || this.note),
      );
    if (!this.path)
      root.child(
        div().p(14).text_color(t.dim).child("Select a changed file in Changes to view its diff."),
      );
    const height = Math.ceil(em(1.65));
    const split = this.diffLayout === "split";
    if (split)
      root.child(
        h_flex()
          .h(28)
          .flex_none()
          .items_center()
          .border_y(1)
          .border_color(t.border)
          .text_size(em(0.8))
          .text_color(t.muted)
          .child(div().flex_1().px(12).child("Before"))
          .child(
            h_flex()
              .flex_1()
              .px(12)
              .gap(5)
              .items_center()
              .border_l(1)
              .border_color(t.border)
              .child(div().flex_1().child("After"))
              .child(
                this.icon(
                  "diff-scroll-left",
                  "chevron-left",
                  "Scroll both sides left",
                  (cx) => this.scrollSplit(-em(16), cx),
                  t,
                  false,
                  !this.splitOffset,
                  20,
                ),
              )
              .child(
                this.icon(
                  "diff-scroll-right",
                  "chevron-right",
                  "Scroll both sides right",
                  (cx) => this.scrollSplit(em(16), cx),
                  t,
                  false,
                  this.splitOffset >= Math.max(0, (this.width || 300) - 160),
                  20,
                ),
              ),
          ),
      );
    // Cache paired rows by array identity. Both sides share one virtual list,
    // which keeps their vertical positions aligned even for unequal hunks.
    if (this.pairedSource !== this.rows) {
      this.pairedSource = this.rows;
      this.pairedRows = splitDiffRows(this.rows);
    }
    const rows = split ? this.pairedRows : this.rows;
    const listId = `factory-diff-${this.context}-${this.path}-${this.scope}-${this.diffLayout}`;
    const viewport = div()
      .flex_1()
      .min_h(0)
      .relative()
      .when(Boolean(codeFont()), (el) => el.font_family(codeFont()))
      .text_size(em(1));
    if (split)
      viewport.child(
        v_virtual_list(
          listId,
          rows.length,
          height,
          (i) => String(i),
          (range) => rows.slice(range.start, range.end).map((row) => this.splitRow(row, t, height)),
        )
          .size_full()
          .on_scroll_wheel((e, cx) => {
            const delta = e.delta.x || (e.modifiers?.shift ? e.delta.y : 0);
            if (delta) {
              this.scrollSplit(-delta, cx);
              cx.stop_propagation();
            }
          }),
      );
    else
      viewport.child(
        div()
          .id("factory-diff-x")
          .size_full()
          .overflow_x_scrollbar()
          .child(
            div()
              .w_full()
              .min_w(this.width || 300)
              .h_full()
              .child(
                v_virtual_list(
                  listId,
                  rows.length,
                  height,
                  (i) => String(i),
                  (range) =>
                    rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, height)),
                ).size_full(),
              ),
          ),
      );
    viewport.child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
    root.child(viewport);
    if (this.truncated)
      root.child(
        div()
          .px(14)
          .py(6)
          .text_size(em(0.8))
          .text_color(t.dim)
          .child("Preview limited to 1,500 lines and 4,000 characters per line."),
      );
    return root;
  }

  // One horizontal offset moves both text columns, leaving line gutters fixed.
  scrollSplit(delta, cx) {
    this.splitOffset = Math.max(
      0,
      Math.min(Math.max(0, (this.width || 300) - 160), this.splitOffset + delta),
    );
    cx.notify();
  }

  splitRow(row, t, height) {
    if (row.kind !== "pair")
      return div()
        .h(height)
        .px(12)
        .w_full()
        .bg(t.raised)
        .text_color(row.kind === "@" ? t.accent : t.dim)
        .truncate()
        .child(row.text);
    const line = h_flex().h(height).w_full();
    for (const [side, entry] of [
      ["left", row.left],
      ["right", row.right],
    ]) {
      const changed = entry?.kind === "+" || entry?.kind === "-";
      const color = entry?.kind === "+" ? t.ansi2 : entry?.kind === "-" ? t.ansi1 : t.foreground;
      line.child(
        h_flex()
          .flex_1()
          .min_w(0)
          .h_full()
          .gap(6)
          .items_center()
          .overflow_hidden()
          .when(side === "right", (el) => el.border_l(1).border_color(t.border))
          .when(changed, (el) => el.bg(color + "18"))
          .when(!entry, (el) => el.bg(t.raised))
          .child(
            div()
              .w(38)
              .flex_none()
              .text_right()
              .text_color(t.dim)
              .child(entry ? String((side === "left" ? entry.old : entry.next) ?? "") : ""),
          )
          .child(
            div()
              .w(10)
              .flex_none()
              .text_color(color)
              .child(changed ? entry.kind : ""),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .overflow_hidden()
              .tooltip(entry?.text || "")
              .child(
                div()
                  .w(this.width || 300)
                  .flex_none()
                  .ml(-this.splitOffset)
                  .whitespace_nowrap()
                  .text_color(color)
                  .child(entry?.text || " "),
              ),
          ),
      );
    }
    return line;
  }

  diffRow(row, t, height) {
    if (row.kind === "@")
      return div().h(height).px(12).w_full().bg(t.raised).text_color(t.accent).child(row.text);
    const color = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.foreground;
    return h_flex()
      .h(height)
      .w_full()
      .gap(8)
      .items_center()
      .when(row.kind === "+" || row.kind === "-", (el) => el.bg(color + "18"))
      .child(
        div()
          .w(38)
          .flex_none()
          .text_right()
          .text_color(t.dim)
          .child(row.old === undefined ? "" : String(row.old)),
      )
      .child(
        div()
          .w(38)
          .flex_none()
          .text_right()
          .text_color(t.dim)
          .child(row.next === undefined ? "" : String(row.next)),
      )
      .child(div().w(12).flex_none().text_color(color).child(row.kind))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .whitespace_nowrap()
          .text_color(color)
          .child(row.text || " "),
      );
  }
}
