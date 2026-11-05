// hands: the panel for the `hands` CLI. It asks for missing permissions and lists
// what hands captured and did; everything else is the CLI (`hands --help`).
import { View } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, appHome } from "herdr";
import { loadSettings, duration } from "./settings.js";
import { PERMISSIONS, PermissionsBlock } from "./views/permissions.js";
import { ActionFilter, ActionList } from "./views/actions.js";
import {
  CaptureList,
  capturesFrom,
  RecordingDetail,
  RecordingHeader,
  RecordingStatus,
} from "./views/recordings.js";
import { SPIN_MS, IconButton, HeaderTab, Message, Panel, PanelHeader } from "./views/ui.js";

const POLL_MS = 5000;
// The pane's own preference; the CLI reads the rest of the block itself.
const DEFAULT_SETTINGS = { pane: { refresh: "5s" } };

export default class Hands extends View {
  init(_props, cx) {
    this.permissions = null; // {accessibility, screen} once read
    this.tab = "captures"; // or "actions"
    this.filter = "all"; // which actions show: all, failed, or one kind
    this.filterOpen = false;
    this.filterIndex = 0;
    this.filterFocus = cx.focus_handle();
    this.filterTrigger = cx.focus_handle();
    this.actions = []; // newest first
    this.recording = null; // {running, file} once read
    this.recordings = []; // finished, newest first
    this.selected = null; // the movie path of the open recording
    this.error = null;
    this.asking = null; // the permission being asked for
    this.collapsed = new Set(); // the days folded away
    this.spinning = false;
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
        this.actions = await this.hands(["actions"]);
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

  runOpen(args, cx) {
    cx.spawn(async (cx) => {
      const result = await exec("open", args, {});
      const file = args.at(-1);
      this.error = result.code === 0 ? null : result.stderr?.trim() || `Could not open ${file}`;
      cx.notify();
    });
  }

  openFile = (file, cx) => this.runOpen([file], cx);

  revealFile = (file, cx) => this.runOpen(["-R", file], cx);

  showTab(tab, cx) {
    this.tab = tab;
    cx.notify();
  }

  select(file, cx) {
    this.selected = file;
    cx.notify();
  }

  actionFilter() {
    return ActionFilter({
      actions: this.actions,
      filter: this.filter,
      open: this.filterOpen,
      index: this.filterIndex,
      focus: this.filterFocus,
      triggerFocus: this.filterTrigger,
      onOpenChange: (open, cx) => {
        this.filterOpen = open;
        this.filterIndex = 0;
        cx.notify();
      },
      onMove: (index, cx) => {
        this.filterIndex = index;
        cx.notify();
      },
      onChoose: (choice, cx) => {
        this.filter = choice.id;
        this.filterOpen = false;
        this.filterTrigger.focus();
        cx.notify();
      },
    });
  }

  toggleDay(key, cx) {
    if (!this.collapsed.delete(key)) this.collapsed.add(key);
    cx.notify();
  }

  // The CLI usually answers at once, so the icon always makes a full turn to be seen.
  refreshNow(cx) {
    this.refresh(cx);
    if (this.spinning) return;
    this.spinning = true;
    cx.notify();
    cx.timer.after(SPIN_MS, (cx) => {
      this.spinning = false;
      cx.notify();
    });
  }

  header() {
    return PanelHeader()
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .ml(-8) // Lines the pills up with the list rows below.
          .gap(4)
          .items_center()
          .role("tab_list")
          .child(
            HeaderTab({
              id: "hands-tab-captures",
              label: "Captures",
              count: capturesFrom(this.actions, this.recordings).length,
              active: this.tab === "captures",
              onClick: (cx) => this.showTab("captures", cx),
            }),
          )
          .child(
            HeaderTab({
              id: "hands-tab-actions",
              label: "Actions",
              count: this.actions.length,
              active: this.tab === "actions",
              onClick: (cx) => this.showTab("actions", cx),
            }),
          ),
      )
      .child(
        IconButton({
          id: "hands-refresh",
          icon: "refresh",
          label: "Refresh",
          spinning: this.spinning,
          onClick: (cx) => this.refreshNow(cx),
        }),
      );
  }

  list() {
    const days = { collapsed: this.collapsed, onToggle: (key, cx) => this.toggleDay(key, cx) };
    if (this.tab === "actions")
      return ActionList({
        actions: this.actions,
        filter: this.filter,
        onOpen: this.openFile,
        onReveal: this.revealFile,
        ...days,
      });
    return CaptureList({
      captures: capturesFrom(this.actions, this.recordings),
      onSelect: (file, cx) => this.select(file, cx),
      onOpen: this.openFile,
      onReveal: this.revealFile,
      ...days,
    });
  }

  render() {
    const open = this.recordings.find((r) => r.file === this.selected);
    const missing = this.permissions && PERMISSIONS.some((p) => !this.permissions[p.key]);
    return Panel({ id: "hands" })
      .child(
        open
          ? RecordingHeader({
              recording: open,
              onBack: (cx) => this.select(null, cx),
              onReveal: this.revealFile,
            })
          : this.header(),
      )
      .when(Boolean(missing), (el) =>
        el.child(
          PermissionsBlock({
            permissions: this.permissions,
            asking: this.asking,
            onAsk: (permission, cx) => this.ask(permission, cx),
          }),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(Message(this.error, true)))
      .when(!open && this.tab === "actions", (el) => el.child(this.actionFilter()))
      .child(
        open
          ? RecordingDetail({
              recording: open,
              actions: this.actions,
              onOpen: this.openFile,
              onReveal: this.revealFile,
            })
          : this.list(),
      )
      .child(RecordingStatus(this.recording));
  }
}
