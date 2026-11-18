// Reading the folder tree, and Git's view of it, for the focused pane's folder.
import { spaces, panes, focused, exec, watchFolder } from "herdr";
import { PER_FOLDER, parseStatus, sortEntries } from "./model.js";
import { indexOf } from "./filter.js";

const INDEX_BYTES = 4000000;
const INDEX_DEPTH = 12;
// A home folder or /, which hold far more than a project, are searched less deep.
const SHALLOW_DEPTH = 5;
const SHALLOW_ROOT = /^\/(?:(?:home|Users)\/[^/]+|root)?$/;
const REINDEX_MS = 30000;
// A folder that keeps changing, such as one an agent is writing in, is read again at most this often.
const RESTALE_MS = 5000;
const SKIPPED = [".git", "node_modules", ".venv", "__pycache__", "target", "dist", ".next"];

// Every file under the folder, for the filter: Git's own list where there is one, so ignored
// files stay out, else find without the folders that are usually huge, cut at a size. A folder
// Git ignores, such as node_modules, gets an empty list from Git, so find reads it instead.
async function everyFile(root, on) {
  const lsFiles = (...flags) =>
    exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "ls-files", "-z", ...flags], { cwd: root, on }).catch(
      () => null,
    );
  // Git still lists a tracked file that was deleted but not staged, so those come out.
  const [git, gone] = await Promise.all([lsFiles("--cached", "--others", "--exclude-standard"), lsFiles("--deleted")]);
  if (git?.code === 0 && git.stdout) {
    if (gone?.code !== 0 || !gone.stdout) return git.stdout;
    const deleted = new Set(gone.stdout.split("\0"));
    return git.stdout
      .split("\0")
      .filter((path) => !deleted.has(path))
      .join("\0");
  }
  const depth = SHALLOW_ROOT.test(root.replace(/\/+$/, "") || "/") ? SHALLOW_DEPTH : INDEX_DEPTH;
  const prune = SKIPPED.map((name) => `-name '${name}'`).join(" -o ");
  const script = `find . -mindepth 1 -maxdepth "$1" \\( ${prune} \\) -prune -o ! -type d -print0 | head -c "$2"`;
  const found = await exec("sh", ["-c", script, "index", String(depth), String(INDEX_BYTES)], { cwd: root, on });
  if (found.code !== 0) throw new Error(found.stderr || "Cannot list this folder.");
  return found.stdout;
}

// Each read of a folder is bounded, and the names come back null-separated, so no file name
// can break the list. Adapted from Herdr's shipped Files mod.
// shortcut: needs `sh`, so a Windows machine shows an error; add a PowerShell listing if one is used.
async function directory(path, on) {
  const script = `n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=\${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt ${PER_FOLDER} ] && break; done; test -d "$1"`;
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder.");
  const fields = r.stdout.split("\0");
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Where a space is now: a terminal's folder in its shown tab, else in its other tabs. The
// space's own folder is where it was made, which its terminals may have long left.
function liveFolder(space) {
  const tabs = space?.tabs ?? [];
  const order = [...tabs.filter((t) => t.active), ...tabs.filter((t) => !t.active)].map((t) => t.id);
  const all = panes();
  for (const tab of order) {
    const pane = all.find((p) => p.tab === tab && p.cwd);
    if (pane) return pane.cwd;
  }
  return null;
}

export const readMethods = {
  // The focused pane's folder. A file or diff tab has no folder of its own, so looking at
  // one keeps the tree where it was instead of jumping back to the space's.
  location() {
    const space = spaces().find((s) => s.active);
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const on =
      f?.pane === null
        ? f.terminal?.includes("/")
          ? f.terminal.split("/")[0]
          : null
        : (space?.machine ?? null);
    const cwd = pane?.cwd || f?.cwd;
    if (!cwd && this.place?.space === space?.id && this.place?.cwd) return this.place;
    return (this.place = { cwd: cwd || liveFolder(space) || space?.folder, on, space: space?.id });
  },

  placeKey() {
    return JSON.stringify(this.location());
  },

  // A folder's own state is kept, so coming back to it is where you left it.
  refresh(cx) {
    const { cwd, on } = this.location();
    const key = this.placeKey();
    if (key !== this.key) {
      if (this.key) this.saved.set(this.key, { folders: this.folders });
      const kept = this.saved.get(key);
      this.key = key;
      this.root = cwd;
      this.on = on;
      this.entries = new Map();
      this.folders = kept?.folders ?? new Set();
      this.marks = {};
      this.top = null;
      this.treeError = null;
      this.indexError = null;
      this.scrollTo = null;
      this.cursor = null;
      this.watch(cx);
    }
    this.ensureIndex(cx);
    if (!cwd || this.loading === key) return;
    const token = key;
    this.loading = key;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (this.key !== token) return;
          await this.loadFolder(path, cwd, on, token);
        }
        await this.loadMarks(cwd, on, token);
        if (this.key === token) this.treeError = null;
      } catch (e) {
        if (this.key === token) this.treeError = e.message ?? String(e);
      } finally {
        if (this.loading === token) this.loading = null;
        cx.notify();
      }
    });
  },

  async loadFolder(path, root, on, token) {
    const list = await directory(path ? `${root}/${path}` : root, on);
    if (this.key !== token) return;
    this.entries.set(path, sortEntries(list));
  },

  // Writes nothing under .git, or the folder watch would see its own read and refresh again.
  async loadMarks(root, on, token) {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(
      () => null,
    );
    if (this.key !== token) return;
    if (top?.code !== 0) {
      this.top = null;
      this.marks = {};
      return;
    }
    const status = await exec(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--no-renames",
        "--untracked-files=all",
      ],
      { cwd: root, on },
    ).catch(() => null);
    if (this.key !== token) return;
    this.top = top.stdout.trim();
    if (status?.code === 0) this.marks = parseStatus(status.stdout, this.top);
  },

  // A local folder says when it changes; another machine's is read on the timer alone.
  watch(cx) {
    const { root, on, key } = this;
    if (on || !root || this.watched === key) return;
    this.watched = key;
    cx.spawn(async (cx) => {
      try {
        while (this.key === key) {
          await watchFolder(root);
          this.changes = (this.changes ?? 0) + 1;
          if (this.index?.key === key) this.index.stale = true;
          if (this.key === key) this.refresh(cx);
        }
      } catch {
        // No watcher here: the timer still refreshes.
      }
      if (this.watched === key) this.watched = null;
    });
  },

  // The filter's list of every file, read when it's first needed, again once the folder
  // changes on disk but at most every 5 seconds, and every 30 for a folder that can't be watched.
  ensureIndex(cx) {
    const { root, on, key } = this;
    if (!root || !this.filterText() || this.indexing === key) return;
    const index = this.index?.key === key ? this.index : null;
    const age = index ? Date.now() - index.at : Infinity;
    if (index && age < (index.stale ? RESTALE_MS : REINDEX_MS)) {
      // The last change before a quiet spell still gets read, once the wait is over.
      if (index.stale && !this.reindexLater) {
        this.reindexLater = true;
        cx.timer.after(RESTALE_MS - age, (cx) => {
          this.reindexLater = false;
          this.ensureIndex(cx);
        });
      }
      return;
    }
    this.indexing = key;
    cx.spawn(async (cx) => {
      try {
        // A change on disk while the list is read leaves it stale, to be read again.
        const changes = this.changes;
        const listing = await everyFile(root, on);
        if (this.key === key) {
          this.index = { key, at: Date.now(), stale: this.changes !== changes, ...indexOf(listing) };
          this.indexError = null;
        }
      } catch (e) {
        if (this.key === key) this.indexError = e.message ?? String(e);
      } finally {
        if (this.indexing === key) this.indexing = null;
        cx.notify();
      }
    });
  },

  toggleFolder(path, cx) {
    if (!this.folders.delete(path)) {
      this.folders.add(path);
      const { root, on, key } = this;
      cx.spawn(async (cx) => {
        try {
          await this.loadFolder(path, root, on, key);
        } catch (e) {
          if (this.key === key) this.treeError = e.message ?? String(e);
        }
        cx.notify();
      });
    }
    cx.notify();
  },

};
