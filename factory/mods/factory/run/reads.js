// Reading the run. Only the helper writes it, and it writes whole files.
import { appHome, exec, readTextFile } from "herdr";

export const readMethods = {
  binary() {
    return `${appHome()}/mods/factory/bin/factory`;
  },

  async helper(args, folder = this.folder()) {
    const result = await exec(this.binary(), args, { cwd: folder });
    if (result.code !== 0) throw new Error(result.stderr?.trim() || `factory ${args[0]} failed`);
    return result.stdout;
  },

  reload(cx) {
    const folder = this.folder();
    if (!folder) return;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${folder}/.herdr-factory/run.json`).catch(() => null);
      if (text === this.raw[folder]) return;
      this.raw[folder] = text;
      try {
        this.runs[folder] = text ? JSON.parse(text) : null;
      } catch {
        return; // Never half written, so this is a hand edit: keep the last good one.
      }
      this.loadResults(cx);
      this.loadHistory(cx);
      cx.notify();
    });
  },

  // A new run is what adds to it, so this follows the run file rather than a timer.
  loadHistory(cx) {
    const folder = this.folder();
    if (!folder) return;
    cx.spawn(async (cx) => {
      try {
        this.histories[folder] = JSON.parse(await this.helper(["history"], folder));
      } catch {
        this.histories[folder] ??= []; // A past run is only history: never in the way of this one.
      }
      this.loadResults(cx);
      cx.notify();
    });
  },

  history() {
    return this.histories[this.folder()] ?? [];
  },

  loadWorkflows(cx) {
    const folder = this.folder();
    if (!folder) return;
    cx.spawn(async (cx) => {
      try {
        this.workflows = JSON.parse(await this.helper(["list", "--json"], folder));
        const { missing } = JSON.parse(await this.helper(["tools", "--json"], folder));
        this.missing = missing;
      } catch (e) {
        this.workflows = [];
        this.error = e.message;
      }
      cx.notify();
    });
  },

  // By the run's start: attempts count from 1 again in each run.
  resultKey(folder, run, stage) {
    return `${folder}:${run.started}:${stage.id}-${stage.attempt}`;
  },

  stageOpenKey(run, stage) {
    return `${run.archive ?? "current"}:${stage.id}`;
  },

  // Only for stages that are open, and once per attempt: a result never changes.
  loadResults(cx) {
    const folder = this.folder();
    const runs = [this.current(), ...this.history()].filter(Boolean);
    const wanted = [];
    for (const run of runs)
      for (const stage of run.stages ?? []) {
        if (!this.openStages.has(this.stageOpenKey(run, stage)) || !stage.attempt) continue;
        wanted.push({ run, id: stage.id, attempt: stage.attempt });
        // Replies name findings by id, and a fixed finding leaves later reviews, so read them all.
        if (stage.replies)
          for (const other of run.stages) {
            const last = other.state === "done" ? other.attempt : other.attempt - 1;
            for (let attempt = 1; other !== stage && attempt <= last; attempt++)
              wanted.push({ run, id: other.id, attempt });
          }
      }
    for (const { run, id, attempt } of wanted) {
      const key = this.resultKey(folder, run, { id, attempt });
      if (key in this.results) continue;
      this.results[key] = undefined;
      cx.spawn(async (cx) => {
        const place = run.archive ? `runs/${run.archive}/` : "";
        const path = `${folder}/.herdr-factory/${place}${id}-${attempt}.json`;
        const text = await readTextFile(path).catch(() => null);
        try {
          this.results[key] = text ? JSON.parse(text) : null;
        } catch {
          this.results[key] = null;
        }
        cx.notify();
      });
    }
  },
};
