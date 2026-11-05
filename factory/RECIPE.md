# Factory

A Herdr mod for staged agent runs, for directing agents rather than doing the work. A Claude Code session is the orchestrator, `factory` records the run in `.herdr-factory/run.json` and controls the stage sessions through `hc`, and a sidebar shows the tree. Judge any addition by whether it helps someone see where a run stands or redirect it.

![Factory](preview.png)

## What you see

It follows Better Changes and Branch PR, in one framed sidebar panel, radius 10, with a 42px header of pill tabs, Run [stages] and Events [n], and refresh on the right. The tab is remembered.

The `/factory` skill starts runs, not the sidebar. With no run, Run says so and lists the workflows as `/factory <name>` with their stages and description, then Open workflows folder.

A run has a fixed block with a rule under it: a colour dot, the workflow's name over its state and start time in small print, and an Actions menu on the right, then a strip of `raised` at half strength, rounded, with Stages done/total, Findings from finished reviews, left out while a review waits to check again (ansi1 with critical or high, ansi3 otherwise, ansi2 at none) and Round during a loop, separated by dots. Stop and close-all confirm in a block under it.

Below it scrolls the tree, joined by 1px lines: the Factory row with the orchestrator's program icon, then each stage with a status icon; its name and what it's doing; its result; and `model · effort · role` in small print. A live stage's row opens its session. On the right are rerun and close icons when they apply, and a chevron on a done stage opening its result: the summary, findings in collapsible groups by severity with title, `file:line` in the code font and detail, replies, and Follow up. Helpers a stage started nest below it.

Events has a filter row with a chooser of All events, The run itself and each stage, then the log, newest first, in collapsible groups by day, with the time in the code font.

Missing `hc` or `claude`, or a helper failure, shows in red under the header. A space on another machine gets a notice.

## How it behaves

The sidebar never shows a prompt. A hidden panel reads nothing, checked through `layout()`. The helper is the only writer of the run file, holds a lock for each command, and replaces the file whole.

Pausing isn't offered: open the session and interrupt it.

## Built from

`mods/factory/`: `main.js`, `settings.js` (shared between this repo's mods), `mod.json` (`place: none`, title Factory), `run/` (`model.js`, `reads.js`), `actions/` (`commands.js`, `menus.js`), `views/` (`ui.js`, `days.js`, `run.js`, `new-run.js`, `events.js`), `icons/`. `helper/` is a standard-library Go program with `defaults/` embedded, split into `main.go`, `run.go`, `config.go` and `session.go`; `helper/install/` builds it to `mods/factory/bin/factory`, writes the defaults and installs `skills/factory/SKILL.md`.

## Watch out

Herdr's shipped layouts are read-only, so the sidebar only shows in a layout the person owns. Never overwrite an unrelated mod or skill on a name clash. Say before installing that the default `dev` stage auto-accepts file edits, and that `args` in `workflow.json` controls this. `herdr-app check` draws only the empty state, so look at the running app too.

## Done when

- `go test ./...` and `go vet ./...` in `helper/`, and `node --test tests/*.test.cjs`, pass, and `herdr-app check` passes.
- `~/.config/herdr-app/mods/factory/bin/factory list` prints the default workflows.
- The sidebar lists the workflows in a space with no run, and `/factory <workflow>` in a Claude session there nests the stages under the orchestrator.
