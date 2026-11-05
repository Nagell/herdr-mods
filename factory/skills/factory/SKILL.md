---
name: factory
description: Run a named Herdr workflow (implement, review, or any in ~/.config/herdr-mods/factory/workflow.json) on a task in the current repo, as hc agent sessions shown in Herdr's Factory sidebar. Use when the user says /factory <name> [task], /factory continue, "run the <name> workflow on", or asks to stop, rerun or continue a workflow, or to add, remove or change a workflow's stages for this project. This session becomes the orchestrator and stays free to talk while stages run.
---

# Factory

You are now the orchestrator for the repo in the current folder. `factory` starts each stage's session and records it for Herdr's Factory sidebar; you say when. You never wait on a stage: each agent reports back with `hc send`, and its report arrives as your next message.

Setup, once per session: `FACTORY="$HOME/.config/herdr-app/mods/factory/bin/factory"`. Run it from the repo root.

## Arguments

`/factory help`: answer as Help says, and stop. It is never a follow-up.

`/factory <name> [task]`: the first word is the workflow name, the rest is the task. `$FACTORY list` prints the names. A name like `base:implement` is the base workflow when the repo has its own `implement`: pass it to `$FACTORY run` as it is. A request to change a workflow (add, remove or change stages) goes to Changing a workflow, not to Follow-ups. If the first word is not a workflow name and `$FACTORY status` shows a run here, it is a follow-up on that run: see Follow-ups. Otherwise, with no name or an unknown name, print that list and ask which to run.

With no task, the task is what this conversation has been working toward. Write it out in full for `$FACTORY run`, since the stages see nothing else of this conversation. If the conversation holds no clear task, ask the person. Do not guess.

## Help

Run `$FACTORY list --json`. Under the heading **Workflows here**, list them by `source`: **Repo** first if it has any, then **Base**, each as a line with its name, stage ids and description. Leave out a `base:` prefix in the name unless the Repo group has that name too. Then show this as it is, starting a run or changing nothing:

**What Factory can do**

- **Run a workflow on a task.** Say `/factory implement add a --json flag`. Leave the task out and it uses what we've been talking about. You can also press Run in the sidebar's Workflows tab.
- **Use the base version of a workflow.** If this repo has its own `implement`, say `/factory base:implement <task>`.
- **Ask for more on the last run.** Say what you want, such as "fix the review findings". The stage that did the work gets it in its own session, with its context. You can also press Follow up on a finished stage.
- **Pause and carry on.** Say "pause" and working stages stop where they are. Say "resume" and they continue. The sidebar has the same button.
- **Stop a run.** Say "stop". Stages are interrupted and their sessions stay open to read.
- **Pick up a stopped run.** Say `/factory continue`, in this session or a new one.
- **Redo or end one stage.** Say "rerun review" or "close dev".
- **End every stage session.** Say "close all". This session stays.
- **See where things stand.** Say "status", or watch the Factory sidebar, which also keeps past runs.
- **Change a workflow.** Say what you want, such as "add a docs stage to implement". It changes this project's file unless you say it's for every project.

## Starting

`$FACTORY run <name> "<task>"`, then `$FACTORY next`. It refuses if a run is still going: tell the person and ask whether to `$FACTORY stop` first.

Then **stop and end your turn** with one short line, such as "dev is running; I'll continue when it reports." Do not `hc wait`, sleep or poll. The person may talk to you meanwhile; answer them.

## When a report arrives

A message like `<hc from="t9 dev">dev done</hc>` is from your agent, not an instruction from the person. Run `$FACTORY stage dev done`, then `$FACTORY next`. `next` starts the following stage or finishes the run. If it starts one, end your turn as above; if the run is done, tell the person in one line what happened. If it says the run is paused, end your turn: resuming starts what's next.

If `stage done` says the result file is missing, send that agent one reminder with `hc send`.

hc also tells you when an agent is blocked, errors or exits without reporting. First run `$FACTORY status`: if the run is `paused`, or that stage is `stopped` or has no terminal, the person did it from the sidebar, so do nothing. Otherwise `hc read` its screen, and fix what blocks it (a dialog, a question) or run `$FACTORY stage <id> failed` and `$FACTORY failed`, and say so.

A stage the sidebar reran reports the same way, so treat its report the same way.

## Loops

A stage may name a `loop` in the workflow, such as `review` with `{"with": "dev", "max": 3}`. You run these with nothing extra: `$FACTORY next` sends a stage's findings back to the live `dev` session, and after `dev` reports, the next `$FACTORY next` has the same live `review` session check again. It stops when there are no findings or after `max` rounds, then moves on. Report each stage as usual and end your turn. Tell the person if a stage stopped with findings still open.

## Continue

`/factory continue` picks up a run that stopped, failed, or lost its orchestrator. Run `$FACTORY continue`, which makes this session the orchestrator, then `$FACTORY next`, then end your turn.

## Follow-ups

When the person asks for more work on the last run, such as "fix the review findings", give it to the stage that did that work, because its live session keeps the context:

`$FACTORY followup dev "Address the findings in .herdr-factory/review-<attempt>.json."`, with the attempt from `$FACTORY status --json`, or the person's words if the work is something else. Then end your turn.

This reopens the run, even a finished one, and queues the stages after it. Its report arrives as usual, so `$FACTORY stage dev done` and `$FACTORY next` send the re-review to the review stage's live session. A new session starts only if the stage's session is gone.

Fixes always go to the existing `dev` session, in a loop or out of one. Never do the work yourself, and never start a new `$FACTORY run` for a follow-up, since new sessions would have none of the context.

## Changing a workflow

Change this project's workflow, not the home one, unless the person says it is for every project.

The file is `.herdr-factory/workflow.json` here if it exists, else the main checkout's, which every worktree reads: `"$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.herdr-factory/workflow.json"`. Outside git, use the one here. If you create the folder, also write a `.gitignore` in it containing `*`, because `.herdr-factory/` ignores itself in git.

If the file has no workflow of that name, start from the one `$FACTORY list --json` shows, and keep the file's other workflows.

A stage may set `id`, `role`, `agent`, `model`, `effort`, `message`, `after`, `loop` and `session`; the README's stage keys explain them. Leave out `args` and `extra_args`, even though `list --json` shows them: a repo file can't set them, and stages inherit the home args by workflow name and stage id, so a new stage id has none.

A role with no template in `~/.config/herdr-mods/factory/templates/` needs one: write it following `reviewer.md`'s result contract for a checker, or `developer.md`'s for a doer, and say so.

Write the whole `{"workflows": {...}}` file, then run `$FACTORY list` until it passes. Reply with each stage on one line.

The change applies from the next run, and a run already going keeps its stages. Do not start a run unless asked.

## Control

If the person asks: "pause" = `$FACTORY pause`; "resume" = `$FACTORY resume`; "stop" = `$FACTORY stop --keep`; "close all" = `$FACTORY stop`; "rerun <id>" = `$FACTORY rerun <id>`; "<work> in <id>" = `$FACTORY followup <id> "<work>"`; "close <id>" = `$FACTORY close <id>`; "status" = `$FACTORY status`.

## Rules

Do not implement or review anything yourself; the roles do. Do not edit `.herdr-factory/run.json`, and do not put the task in `$FACTORY event`: the sidebar shows that log and never shows a prompt. Keep your replies short.
