import { em } from "./typography.js";
import { find, buttons, execute, matches, isActive } from "./actions.js";
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, closeOverlay, theme, window, shared, layout, settings, nextCommand, props, notify } from "herdr";

const ASSETS = "mods/better-tabs/";
const DEFAULTS = {
  rememberPanels: { container: "panel", stack: "panel-body" },
  buttons: [
    { id: "files", label: "Files", icon: "file", when: { node: "files" }, action: { type: "panel", container: "panel", stack: "panel-body", target: "files" } },
    { id: "changes", label: "Changes", icon: "changes", when: { node: "changes" }, action: { type: "panel", container: "panel", stack: "panel-body", target: "changes" } },
  ],
};

export default class Tabs extends View {
  config() { return { ...DEFAULTS, ...props() }; }
  init(_props, cx) {
    this.pressed = null;
    this.panels = {};
    try { const saved = JSON.parse(localStorage.getItem("panels") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) this.panels = saved;
    } catch { /* Ignore malformed saved preferences. */ }
    if (this.config().mode !== "overflow") {
      // Synchronization can issue layout commands, so it must not run in render.
      this.syncPanel();
      cx.timer.every(300, () => this.syncPanel());
      cx.spawn(async cx => {
        for (;;) {
          const command = await nextCommand();
          this.command(command, cx);
        }
      });
    }
  }
  entries() { return buttons(this.config(), shared("better-tabs.buttons")); }
  command(command, cx) {
    const config = this.config();
    if (command === "overflow") { this.openActions(this.entries()); return; }
    const entry = command.startsWith("button:") ? this.entries().find(b => b.id === command.slice(7)) : null;
    const action = entry?.action ?? config.commands?.[command];
    if (entry && !this.enabled(entry)) return;
    if (action) this.act(action, cx);
  }
  enabled(button) { return !button.disabled && (!button.enabledWhen || matches(button.enabledWhen)); }
  act(action, cx) {
    const space = spaces().find(s => s.active);
    const failed = error => notify({ title: "Better Tabs", body: String(error.message ?? error), level: "error" });
    try {
      const result = execute(action, { space, tab: space?.tabs?.find(t => t.active), cx, onError: failed });
      if (result?.catch) result.catch(failed);
    } catch (error) { failed(error); }
  }
  syncPanel() {
    const config = this.config(), memory = config.rememberPanels;
    if (!memory) return;
    const space = spaces().find(s => s.active), root = layout();
    const panel = find(root, memory.container), body = find(root, memory.stack);
    if (!space || !panel || !body) return;
    const key = JSON.stringify([memory.container, memory.stack, space.id]);
    const now = panel.hidden ? null : body.active;
    if (key !== this.spaceKey) {
      const first = this.spaceKey === undefined;
      this.spaceKey = key;
      this.pending = null;
      if (!(first && !Object.prototype.hasOwnProperty.call(this.panels, key))) {
        const stored = this.panels[key];
        const want = body.children?.some(c => c.id === stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) {
            run("layout.select", { stack: memory.stack, child: want });
            run("layout.show", { id: memory.container });
          } else run("layout.hide", { id: memory.container });
          return;
        }
      }
    }
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[key] === now) return;
    this.panels[key] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }
  icon(name, size = 14) {
    // Bare icon names use bundled assets; a path is relative to Herdr app home.
    return svg(name.includes("/") ? name : `${ASSETS}${name}.svg`).size(size).flex_none();
  }
  actionButton(entry, cx, menu = false) {
    const t = theme(), enabled = this.enabled(entry);
    const active = entry.activeWhen ? matches(entry.activeWhen) : isActive(entry.action);
    const badge = entry.badge?.shared ? shared(entry.badge.shared) : entry.badge;
    return h_flex().id(`action-${entry.id}`).h(menu ? 32 : 26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(em(0.95)).bg(active ? t.selected : t.chrome).text_color(!enabled ? t.dim : active ? t.foreground : t.muted)
      .tooltip(entry.tooltip ?? entry.label ?? entry.id).accessibility_label(entry.label ?? entry.id)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!enabled) return;
        if (menu) closeOverlay(props().overlay);
        this.act(entry.action, cx);
      })
      .when(Boolean(entry.icon), el => el.child(this.icon(entry.icon)))
      .when(menu || !entry.iconOnly || !entry.icon, el => el.child(entry.label ?? entry.id))
      .when(badge !== undefined && badge !== null && badge !== false && badge !== "", el =>
        el.child(div().text_size(em(0.8)).text_color(t.accent).child(String(badge))));
  }
  openActions(entries) {
    if (!entries.length) return;
    openOverlay({ mod: "better-tabs", kind: "popup", width: 240, height: Math.min(600, entries.length * 34 + 10),
      props: { ...this.config(), mode: "overflow", buttons: entries, contributions: false, rememberPanels: false } });
  }
  render(cx) {
    const config = this.config(), t = theme(), entries = this.entries();
    if (config.mode === "overflow") return v_flex().p(5).gap(2).text_color(t.foreground).bg(t.chrome)
      .children(entries.map(b => this.actionButton(b, cx, true)));
    const space = spaces().find(s => s.active), shown = space?.tabs ?? [], ps = panes();
    const stop = (_e, cx) => cx.stop_propagation();
    const simple = (id, label, tooltip, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center()
      .rounded(6).text_color(t.dim).tooltip(tooltip).accessibility_label(tooltip)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action).child(label);
    const item = (tab, index) => {
      const program = ps.find(p => p.tab === tab.id && p.program?.agent)?.program ?? ps.find(p => p.tab === tab.id)?.program;
      return h_flex().id(`tab-${tab.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(em(1))
        .border(1).border_color(tab.active ? t.border : t.chrome).bg(tab.active ? t.raised : t.chrome)
        .text_color(tab.active ? t.foreground : t.muted).hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation(); this.pressed = index;
          if (e.click_count === 2) run("tab.rename", { id: tab.id });
        })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && shown[from] && from !== index) run("tab.move", { id: shown[from].id, index: index + 1 });
          else run("tab.select", { id: tab.id });
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200,
            props: { tab: "tab", target: { id: tab.id, space: space.id } } });
        })
        .when(config.programIcons !== false && Boolean(program?.icon), el => el.child(
          program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(config.tabMaxWidth ?? 170).truncate().tooltip(tab.name).child(tab.zoomed ? `${tab.name} Z` : tab.name))
        .when(config.statusIndicators !== false && tab.status === "working", el =>
          el.child(this.icon("spinner", 12).text_color(t.working).spin(900)))
        .when(config.statusIndicators !== false && ["blocked", "done"].includes(tab.status), el =>
          el.child(div().size(6).rounded(3).bg(t[tab.status])))
        .when(config.closeButtons !== "none" && (tab.active || config.closeButtons === "all"), el =>
          el.child(simple(`close-${tab.id}`, this.icon("close", 12), "Close tab", (_e, cx) => {
            cx.stop_propagation(); run("tab.close", { id: tab.id });
          })));
    };
    const root = layout(), sidebar = find(root, config.sidebar ?? "sidebar"), w = window();
    const padding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / (settings().zoom || 1) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0)) : 10;
    // Reserve the bulk of the bar for tabs. Explicit maxButtons can constrain it further.
    const limit = Math.max(0, Math.min(config.maxButtons ?? Infinity, Math.floor(((this.width ?? 1200) - 350) / 100)));
    const visible = entries.filter(b => b.overflow !== true).slice(0, limit);
    const overflow = entries.filter(b => !visible.includes(b));
    const bar = h_flex().id("better-tabs-root").text_size(em(1)).size_full().min_w(0).px(10).pl(padding).gap(3)
      .items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_mouse_up("left", () => { this.pressed = null; })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar()
        .on_scroll_wheel(e => { if (config.scrollNavigation !== false && Math.abs(e.delta.y) >= 1)
          run(e.delta.y > 0 ? "tab.prev" : "tab.next"); }).children(shown.map(item)))
      .when(config.newButton !== false, el => el.child(simple("tab-new", "+", "New tab", () =>
        openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))));
    let group;
    for (const entry of visible) {
      if (group !== undefined && entry.group !== group) bar.child(div().w(1).h(16).mx(4).bg(t.border));
      group = entry.group;
      bar.child(this.actionButton(entry, cx));
    }
    if (overflow.length) bar.child(simple("actions-more", "…", "More actions", () => this.openActions(overflow)));
    if (w?.buttons) bar
      .child(simple("minimize", w.platform === "windows" ? this.icon("win-min", 16) : "−", "Minimize", () => run("window.minimize")))
      .child(simple("maximize", w.platform === "windows" ? this.icon(w.maximized ? "win-restore" : "win-max", 16) : "□", "Maximize", () => run("window.maximize")))
      .child(simple("close-window", this.icon("close", 13), "Close window", () => run("window.close")));
    return bar;
  }
}
