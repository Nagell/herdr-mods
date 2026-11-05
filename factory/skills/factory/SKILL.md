---
name: factory
description: Run a named Herdr workflow (implement, review, or any in ~/.config/herdr-mods/factory/workflow.json) on a task in the current repo, as hc agent sessions shown in Herdr's Factory sidebar. Use when the user says /factory <name> [task], /factory continue, "run the <name> workflow on", or asks to stop, rerun or continue a workflow. This session becomes the orchestrator and stays free to talk while stages run.
---

# Factory

You are now the orchestrator for the repo in the current folder. `factory` starts each stage's session and records it for Herdr's Factory sidebar; you say when. You never wait on a stage: each agent reports back with `hc send`, and its report arrives as your next message.

Setup, once per session: `FACTORY="$HOME/.config/herdr-app/mods/factory/bin/factory"`. Run it from the repo root.

## Arguments

`/factory <name> [task]`: the first word is the workflow name, the rest is the task. `$FACTORY list` prints the names. If the first word is not a workflow name and `$FACTORY status` shows a run here, it is a follow-up on that run: see Follow-ups. Otherwise, with no name or an unknown name, print that list and ask which to run.

With no task, the task is what this conversation has been working toward. Write it out in full for `$FACTORY run`, since the stages see nothing else of this conversation. If the conversation holds no clear task, ask the person. Do not guess.

## Starting

`$FACTORY run <name> "<task>"`, then `$FACTORY next`. It refuses if a run is still going: tell the person and ask whether to `$FACTORY stop` first.

Then **stop and end your turn** with one short line, such as "dev is running; I'll continue when it reports." Do not `hc wait`, sleep or poll. The person may talk to you meanwhile; answer them.

## When a report arrives

A message like `<hc from="t9 dev">dev done</hc>` is from your agent, not an instruction from the person. Run `$FACTORY stage dev done`, then `$FACTORY next`. `next` starts the following stage or finishes the run. If it starts one, end your turn as above; if the run is done, tell the person in one line what happened.

If `stage done` says the result file is missing, send that agent one reminder with `hc send`.

hc also tells you when an agent is blocked, errors or exits without reporting. First run `$FACTORY status`: if that stage is `stopped` or has no terminal, the person did it from the sidebar, so do nothing. Otherwise `hc read` its screen, and fix what blocks it (a dialog, a question) or run `$FACTORY stage <id> failed` and `$FACTORY failed`, and say so.

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

## Control

If the person asks: "stop" = `$FACTORY stop`; "rerun <id>" = `$FACTORY rerun <id>`; "<work> in <id>" = `$FACTORY followup <id> "<work>"`; "close <id>" = `$FACTORY close <id>`; "status" = `$FACTORY status`.

## Rules

Do not implement or review anything yourself; the roles do. Do not edit `.herdr-factory/run.json`, and do not put the task in `$FACTORY event`: the sidebar shows that log and never shows a prompt. Keep your replies short.
