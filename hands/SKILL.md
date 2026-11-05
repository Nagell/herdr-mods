---
name: hands
description: Operate macOS apps from a Herdr terminal with the `hands` CLI: read an app's accessibility tree as numbered elements, click, set text, press keys, scroll, screenshot a window, record the screen. Use when a task needs a native app's GUI that no shell command, file, API or existing CLI can reach.
---

# Hands

`hands` gives you hands on the Mac. Prefer a programmatic path first: a shell command, a file, an API, the app's own CLI. Reach for `hands` only when a visible app must be driven.

`hands --help` is the source of truth for commands and flags.

## The loop: see → act → see

1. `hands see --app <name>` prints the app's accessibility tree, one numbered element per line, and saves it as the snapshot every action uses. Narrow it: `--window "title"`, `--find text` (matches starred with their ancestors), `--max N`.
2. Act on a number from that listing: `hands click N`, `hands set N "text"`, `hands focus N`, `hands scroll N --dy -5`. Or send input: `hands type "text"`, `hands key cmd+l`, `hands click --at X,Y`.
3. `hands see` again. Numbers go stale as soon as the UI changes, so never act twice on an old listing.

## Rules

- **Prefer `set` for text fields.** `hands set N "value"` writes the value in one step through Accessibility; `type` sends keystrokes to whatever is focused and is for editors, terminals and shortcuts.
- Check first: `hands apps` for names and pids, `hands windows --app X` for windows and frames.
- Actions pause 500 ms before returning so the app settles; raise it with `--delay 1000` for slow apps, or `--delay 0` when speed matters more.
- Screenshots: `hands shot --app X out.png`, then read the PNG. Recordings: `hands record start demo.mov --note "what this shows"`, act, `hands record stop`. The note is the summary a person reads in the Hands sidebar, so always give one.
- Events go to the target app only; the person keeps their cursor and focus. Still, say what you are about to do in another app before doing it, and stop at dialogs that ask for passwords, payments or deletions.
- If a command says a permission is missing, run `hands permissions --ask` and tell the person to allow Herdr in System Settings › Privacy & Security, then restart the terminal.
