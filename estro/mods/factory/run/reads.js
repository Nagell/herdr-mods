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
      cx.notify();
    });
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

  resultKey(folder, stage) {
    return `${folder}:${stage.id}-${stage.attempt}`;
  },

  // Only for stages that are open, and once per attempt: a result never changes.
  loadResults(cx) {
    const folder = this.folder();
    for (const stage of this.current()?.stages ?? []) {
      const key = this.resultKey(folder, stage);
      if (!this.openStages.has(stage.id) || !stage.attempt || key in this.results) continue;
      this.results[key] = undefined;
      cx.spawn(async (cx) => {
        const path = `${folder}/.herdr-factory/${stage.id}-${stage.attempt}.json`;
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
