// Better Spaces: a native spaces sidebar with right-aligned branches, nested
// worktrees, and a PR status line. Repository facts follow each space's first
// terminal. Agent attention and GitHub PR state remain separate concepts.

import { PRStatusObserver, prPlaceKey, prAppearance } from "./pr-status.js";
import { em } from "./typography.js";
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  spaces,
  machines,
  panes,
  run,
  openOverlay,
  exec,
  hc,
  theme,
  shared,
  setShared,
  watchFolder,
  window,
  layout,
} from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 15000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  // ── Lifecycle and refresh scheduling ──────────────────────────────────────

  init(_props, cx) {
    this.prObserver = new PRStatusObserver();
    this.git = Object.create(null); // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set();
    try {
      this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    } catch {
      /* Ignore invalid saved UI state. */
    }
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    this.updateColors(sp);
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const ps = panes();
    const places = sp.map((s) => {
      const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
      const folder = place(s, ps);
      return {
        folder,
        machine: s.machine,
        branch:
          ps.find((p) => tabs.has(p.tab) && p.cwd === folder)?.branch ??
          this.git[prPlaceKey(s.machine, folder)]?.branch,
      };
    });
    this.prObserver.refresh(places, cx);
    const due = this.due(now, sp, ps);
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = Object.create(null);
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    // Herdr reports terminal branch changes live. Refresh our richer metadata
    // promptly, instead of waiting for a filesystem event or fallback poll.
    for (const s of sp) {
      const key = at[s.id];
      const folder = place(s, ps);
      const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
      const branch = ps.find((p) => tabs.has(p.tab) && p.cwd === folder)?.branch;
      if (
        branch &&
        !this.unsure.has(key) &&
        this.git[key]?.branch !== branch &&
        now - (this.checked[key] ?? 0) > 1000
      )
        due.add(key);
    }
    for (const [id, k] of Object.entries(at))
      if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane])
        this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false)
        for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK)
          due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0)
          this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(
        Object.values(this.git)
          .filter(Boolean)
          .map((g) => JSON.parse(g.repo))
          .filter(([on]) => !on)
          .map(([, repo]) => repo),
      );
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // ── Read-only Git metadata and local watches ──────────────────────────────

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec(
        "git",
        [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "status",
          "--porcelain=v2",
          "--branch",
        ],
        { cwd, on },
      );
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        on,
      });
      const common = await exec(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd, on },
      );
      if (top.code !== 0 || common.code !== 0) throw new Error("Cannot read repository metadata");
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git")
        ? base(repo.slice(0, -5))
        : base(repo).replace(/\.git$/, "");
      const info = {
        name,
        branch: null,
        ahead: 0,
        behind: 0,
        repo: JSON.stringify([on, repo]),
        linked: repo !== `${top.stdout.trim()}/.git`,
      };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo))
            this.refreshGit(
              Object.keys(this.git).filter((k) => this.git[k]?.repo === mine),
              cx,
            );
        }
      } catch {
        this.watching.delete(repo);
      }
    });
  }

  // ── Space navigation and worktree/machine grouping ────────────────────────

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({
      mod: "menu",
      kind: "popup",
      width: 200,
      height: 260,
      props: { tab: "space", target: { id: w.id } },
    });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(),
      ps = panes();
    const ready = (w) =>
      this.shown.has(w.id) ||
      where(w, ps) in this.git ||
      Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp
      .map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }))
      .filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [
      ...new Set([
        ...rows.map((r) => r.w.machine).filter(Boolean),
        ...this.machines.map((m) => m.name),
      ]),
    ].sort();
    const loading = (m) => {
      const layout = machines().find((k) => k.name === m)?.layout;
      return (
        layout === "loading" ||
        (!layout && this.machines.some((k) => k.name === m && k.state === "connected")) ||
        spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id))
      );
    };
    const loadingRow = (m) =>
      div()
        .id(`machine-loading-${m ?? "local"}`)
        .h(28)
        .flex_none()
        .px(8)
        .text_size(em(0.95))
        .text_color(t.dim)
        .child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find((k) => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex()
        .id(`machine-${m ?? "local"}`)
        .h(26)
        .flex_none()
        .px(collapsed ? 2 : 8)
        .gap(7)
        .items_center()
        .text_size(em(0.85))
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(
          svg(`mods/better-spaces/${m ? "server" : "monitor"}.svg`)
            .size(13)
            .flex_none(),
        )
        .when(!collapsed, (el) =>
          el
            .child(
              div()
                .flex_1()
                .truncate()
                .child(m ?? "This computer"),
            )
            .when(!connected, (el) =>
              el.child(
                div()
                  .flex_none()
                  .child((machine?.state ?? "asleep").replace(/_/g, " ")),
              ),
            )
            .when(connected, (el) =>
              el.child(
                div()
                  .id(`machine-add-${m ?? "local"}`)
                  .flex_none()
                  .px(4)
                  .rounded(4)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    run("space.new", m ? { machine: m } : {});
                  })
                  .child("+"),
              ),
            )
            .child(
              div()
                .size(6)
                .rounded(3)
                .flex_none()
                .bg(connected ? t.ansi2 : t.dim),
            )
            .child(
              svg(`mods/better-spaces/chevron-${folded ? "right" : "down"}.svg`)
                .size(11)
                .flex_none(),
            ),
        );
      const empty = h_flex()
        .id(`machine-new-${m ?? "local"}`)
        .h(28)
        .flex_none()
        .px(8)
        .gap(7)
        .items_center()
        .rounded(7)
        .text_size(em(0.95))
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/better-spaces/plus.svg").size(12))
        .when(!collapsed, (el) => el.child("New space there"));
      return [
        head,
        ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : empty]),
      ];
    });
  }

  // ── Branch and PR descriptions ───────────────────────────────────────────

  // Always show the branch on the name row, even main/master or a branch whose
  // name is already the worktree's title. The flexible tail aligns it right.
  gitTail(g, tree, name, t) {
    const branch = g.branch === "(detached)" ? "detached" : (g.branch ?? "detached");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(em(0.9))
      .text_color(t.dim)
      .child(div().min_w(0).truncate().tooltip(branch).child(branch))
      .when(g.ahead > 0, (el) =>
        el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)),
      )
      .when(g.behind > 0, (el) =>
        el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)),
      );
  }

  // The branch and PR must describe the same checkout: the space's first
  // terminal, matching Herdr's space naming and worktree grouping semantics.
  checkoutStatus(w) {
    const ps = panes();
    const folder = place(w, ps);
    const tabs = new Set((w.tabs ?? []).map((tab) => tab.id));
    const branch =
      ps.find((pane) => tabs.has(pane.tab) && pane.cwd === folder)?.branch ??
      this.git[prPlaceKey(w.machine, folder)]?.branch;
    const status = this.prObserver.entries.get(prPlaceKey(w.machine, folder));
    return status?.branch === branch ? status : null;
  }
  checkoutPRs(w) {
    return this.checkoutStatus(w)?.prs ?? [];
  }
  prBadge(w, t, compact = false) {
    const prs = this.checkoutPRs(w);
    if (!prs.length) return null;
    const badge = h_flex().gap(5).flex_none().items_center();
    // Keep the sidebar width bounded when a branch targets several base repos.
    for (const pr of prs.slice(0, 1)) {
      const status = prAppearance(pr, t);
      badge.child(
        h_flex()
          .id(`space-pr-${w.id}-${pr.repository}-${pr.number}`)
          .gap(3)
          .items_center()
          .text_color(status.color)
          .tooltip(`${pr.repository}#${pr.number} · ${status.label}\n${pr.title}`)
          .child(svg(`mods/better-spaces/${status.icon}.svg`).size(13).flex_none())
          .when(!compact, (el) =>
            el.child(div().text_size(em(0.85)).child(`#${pr.number} · ${status.label}`)),
          ),
      );
    }
    if (!compact && prs.length > 1)
      badge.child(
        div()
          .text_size(em(0.8))
          .text_color(t.dim)
          .tooltip(
            prs
              .slice(1)
              .map((pr) => `${pr.repository}#${pr.number} · ${pr.title}`)
              .join("\n"),
          )
          .child(`+${prs.length - 1}`),
      );
    return badge;
  }
  prLine(w, t, tree) {
    const status = this.checkoutStatus(w);
    return h_flex()
      .id(`space-pr-line-${w.id}`)
      .h(20)
      .pl(tree ? 44 : 27)
      .gap(6)
      .items_center()
      .tooltip(
        status?.error ? `PR refresh failed: ${status.error}` : "Pull requests for this checkout",
      )
      .when(Boolean(status?.prs.length), (el) => el.child(this.prBadge(w, t)))
      .when(Boolean(status?.error), (el) =>
        el.child(
          div()
            .text_size(em(0.8))
            .text_color(t.dim)
            .child(status.prs.length ? "· stale" : "PR unavailable"),
        ),
      );
  }
  // ── Expanded/compact rows and sidebar rendering ──────────────────────────

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const status = this.checkoutStatus(w);
    const hasPRLine = Boolean(status?.prs.length || status?.error);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }) + (hasPRLine ? 22 : 0))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) =>
        el.child(
          div()
            .absolute()
            .left(0)
            .right(0)
            .h(2)
            .bg(t.accent)
            .when(this.pressed < i, (line) => line.bottom(0))
            .when(this.pressed > i, (line) => line.top(0)),
        ),
      )
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i)
          run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), (el) =>
            el.pl(22).child(svg("mods/better-spaces/branch.svg").size(13).text_color(t.dim)),
          )
          .when(!tree, (el) =>
            el.child(
              h_flex()
                .size(18)
                .flex_none()
                .rounded(5)
                .bg(fill)
                .items_center()
                .justify_center()
                .text_size(em(0.82))
                .font_bold()
                .text_color("#ffffff")
                .child([...w.name][0]?.toUpperCase() ?? "?"),
            ),
          )
          .child(
            div()
              .min_w(0)
              .max_w(150)
              .truncate()
              .tooltip(w.name)
              .text_color(t.foreground)
              .child(w.name),
          )
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      )
      .when(hasPRLine, (el) => el.child(this.prLine(w, t, Boolean(tree))));
  }

  compact({ w, i }, t) {
    const badge = this.prBadge(w, t, true);
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(
        div()
          .text_color(w.active ? t.foreground : t.muted)
          .child(String(i + 1)),
      )
      .when(Boolean(badge), (el) => el.child(badge))
      .when(!badge, (el) => el.child(div().text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  // Share avatar colors with Herdr's own space menus. Do this during data
  // synchronization, never render: setShared itself schedules a redraw.
  updateColors(sp) {
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(
      Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)),
    );
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
  }

  render() {
    const t = theme();
    const collapsed = (this.width ?? find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    return v_flex()
      .id("better-spaces-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(em(1))
      .on_size_change((size, cx) => {
        const wasCollapsed = (this.width ?? Infinity) < 160;
        this.width = size.width;
        if (wasCollapsed !== this.width < 160) cx.notify();
      })
      .child(
        h_flex()
          .h(31)
          .pl(16)
          .pr(10)
          .items_center()
          .justify_between()
          .text_size(em(0.9))
          .text_color(t.dim)
          .when(!collapsed, (el) => el.child("Spaces"))
          .child(
            div()
              .id("space-new")
              .size(26)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("space.new"))
              .child(svg("mods/better-spaces/plus.svg").size(14)),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode("always")
          .on_mouse_up("left", (_e, cx) => {
            this.pressed = null;
            cx.notify();
          })
          .children(this.grouped(t, collapsed)),
      );
  }
}
