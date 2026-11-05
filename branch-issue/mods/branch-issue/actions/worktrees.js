// Starting work on an issue: its checkouts, and making a new one as a new space.
import { InputState } from "gpui-base";
import { spaces, exec, home, run, knownAgents } from "herdr";
import { folderName, identifiersIn, issuePrompt, slug } from "../linear/model.js";

export const worktreeMethods = {
  // Worktrees already checked out for this issue: branches whose
  // `branch.<name>.herdr-issue` binding names it, joined to `git worktree list`.
  loadWorktrees(cx) {
    const { sp, issue } = this;
    if (!sp || !issue) return;
    const identifier = issue.identifier;
    cx.spawn(async (cx) => {
      const options = { cwd: sp.folder, on: sp.machine };
      const bound = await exec(
        "git",
        ["config", "--get-regexp", "^branch\\..*\\.herdr-issue$"],
        options,
      );
      const branches = new Set();
      for (const line of (bound.stdout ?? "").split("\n")) {
        const match = /^branch\.(.+)\.herdr-issue (.+)$/.exec(line.trim());
        if (match && identifiersIn(match[2]).includes(identifier)) branches.add(match[1]);
      }
      const list = [];
      if (branches.size) {
        const out = await exec("git", ["worktree", "list", "--porcelain"], options);
        for (const block of (out.stdout ?? "").split("\n\n")) {
          const path = /^worktree (.+)$/m.exec(block)?.[1];
          const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
          if (path && branch && branches.has(branch))
            list.push({ path, branch, name: folderName(path) });
        }
      }
      if (this.issue?.identifier === identifier) this.worktrees = { identifier, list };
      cx.notify();
    });
  },

  currentWorktrees() {
    return this.worktrees?.identifier === this.issue?.identifier ? this.worktrees.list : [];
  },

  worktreeSpace(worktree) {
    const machine = this.sp?.machine ?? null;
    return spaces().find((s) => s.folder === worktree.path && (s.machine ?? null) === machine);
  },

  // Open the form. Linear computes `branchName` with the team's convention; a
  // numeric suffix skips branches that already have a worktree here.
  showWorktree(cx) {
    if (!this.issue || !this.sp) return;
    const taken = new Set(this.currentWorktrees().map((w) => w.branch));
    const base =
      this.issue.branchName || slug(`${this.issue.identifier}-${this.issue.title}`).slice(0, 60);
    let branch = base;
    for (let i = 2; taken.has(branch); i++) branch = `${base}-${i}`;
    const form = {
      issue: this.issue,
      sp: { ...this.sp },
      branch: InputState.new({ value: branch }),
      name: InputState.new({ value: slug(branch) }),
      base: InputState.new({ value: "main" }),
      launch: this.settings.worktrees.open_with, // terminal or an installed agent's program key
      agents: [],
      start: this.settings.worktrees.move_to_started, // move the issue to started after creation
    };
    this.worktreeForm = form;
    // The worktree name follows the branch until the person edits it themselves.
    form.branch.on("change", (_e, cx) => {
      if (!form.nameEdited) form.name.set_value(slug(form.branch.value().trim()));
      cx.notify();
    });
    form.name.on("change", (_e, cx) => {
      form.nameEdited = form.name.value() !== slug(form.branch.value().trim());
      cx.notify();
    });
    form.base.on("change", () => {
      form.baseEdited = true;
    });
    for (const input of [form.branch, form.name, form.base])
      input.on("submit", (_e, cx) => this.createWorktree(cx));
    form.branch.focus();
    // The base defaults to the remote's HEAD; the launch choices to what is installed.
    cx.spawn(async (cx) => {
      try {
        const head = await exec(
          "git",
          ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
          { cwd: form.sp.folder, on: form.sp.machine },
        );
        const name = head.code === 0 ? head.stdout.trim().replace(/^origin\//, "") : "";
        if (name && this.worktreeForm === form && !form.baseEdited) form.base.set_value(name);
        const agents = await knownAgents({ on: form.sp.machine ?? null });
        if (this.worktreeForm === form) form.agents = agents.filter((a) => a.installed);
      } catch {}
      cx.notify();
    });
    cx.notify();
  },

  launchChoices(form) {
    return [{ key: "terminal", name: "Terminal" }, ...form.agents];
  },

  createWorktree(cx) {
    const form = this.worktreeForm;
    if (!form || form.busy || form.path) return;
    const branch = form.branch.value().trim();
    const name = form.name.value().trim();
    const base = form.base.value().trim();
    form.error = null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      form.error = "Use letters, numbers, dots, dashes or underscores for the worktree name.";
      cx.notify();
      return;
    }
    if (!base) {
      form.error = "Enter the base branch to start from.";
      cx.notify();
      return;
    }
    const { sp, issue } = form;
    form.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const git = async (args) => {
        const result = await exec("git", args, { cwd: sp.folder, on: sp.machine });
        if (result.code !== 0)
          throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Git command failed.");
        return result.stdout.trim();
      };
      try {
        if ((await git(["check-ref-format", "--branch", branch])) !== branch)
          throw new Error("Enter a literal branch name.");
        const existing = await exec(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          { cwd: sp.folder, on: sp.machine },
        );
        if (existing.code === 0)
          throw new Error("That branch already exists. Choose a new branch name.");
        if (existing.code !== 1)
          throw new Error(existing.stderr?.trim() || "Could not check existing branches.");
        const root = this.settings.worktrees.root.replace(/^~(?=\/|$)/, await this.homeOf(sp));
        const path = `${root}/${folderName(sp.folder)}/${name}`;
        // Start from the remote's base so the branch is not behind before work begins.
        await git(["fetch", "--no-tags", "origin", base]);
        await git(["worktree", "add", "-b", branch, "--", path, "FETCH_HEAD"]);
        // Retain the checkout if opening its space fails, so retry cannot create it twice.
        form.path = path;
        form.createdName = name;
        await git(["config", `branch.${branch}.herdr-issue`, issue.identifier]);
        if (form.start) {
          const started = (issue.team?.states ?? []).find((s) => s.type === "started");
          if (started && issue.state?.id !== started.id)
            await this.api({ action: "update", issue: issue.id, stateId: started.id }, sp);
        }
        this.openWorktree(form, cx);
      } catch (error) {
        form.error = error.message;
      } finally {
        form.busy = false;
        cx.notify();
      }
    });
  },

  // The home folder on the space's machine, where ~/.herdr/worktrees lives.
  async homeOf(sp) {
    if (!sp.machine) return home();
    let result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: sp.machine });
    if (result.code !== 0 || !result.stdout.trim())
      result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], {
        on: sp.machine,
      });
    if (result.code !== 0 || !result.stdout.trim())
      throw new Error("Could not find the remote home folder.");
    return result.stdout.trim().replace(/\\/g, "/");
  },

  // A new space for the checkout: nested under the repo at once, with a shell
  // or the chosen agent in its first tab. An agent gets the issue as its prompt.
  openWorktree(form, cx) {
    const agent = form.agents.find((a) => a.key === form.launch);
    try {
      run("space.new", {
        folder: form.path,
        machine: form.sp.machine ?? null,
        tab: form.createdName,
        ...(agent ? { argv: [...agent.run, issuePrompt(form.issue)] } : {}),
      });
      form.opened = true;
      form.error = null;
      if (this.worktreeForm === form) this.worktreeForm = null;
      // Reload the detail when the state moved, else only the worktree list.
      if (form.start) this.openIssue(form.issue.identifier, cx);
      else this.loadWorktrees(cx);
    } catch (error) {
      form.error = `Worktree created at ${form.path}. Could not open its space: ${error.message}`;
    }
    cx.notify();
  },
};
