# hands

A Herdr mod that gives a coding agent hands on the rest of the Mac through one command, `hands`: list apps and windows, read an app's accessibility tree as numbered lines, press, set, focus, type, key chords, scroll, screenshot a window, record the screen. Built from scratch on the system frameworks: Go with cgo and Objective-C, no third-party computer-use tool as a dependency or a reference. Simple, light, just works. The mod pane is tiny and shows only permission state, a button to ask for it, and whether a recording runs.

## What you see

The pane, `place: none`, is a theme-background card with a 1px border and 10px rounding: a "hands" heading, two rows (Accessibility, Screen Recording) each with a green/red dot and "granted"/"missing", a **Grant access** button only while something is missing, a recording row with a red dot and the file path while recording, and any error in red. It polls `hands permissions --json` and `hands record status --json` every five seconds through `exec` on the installed binary.

The CLI prints plain text: `see` prints a header line then `index  role "title" [description] = "value" placeholder "…" (x,y w×h) disabled focused`, indented two spaces per depth; `--find` prints matches starred with their ancestors; capped output says how many lines are hidden. `--json` returns the data instead. Every error names the fix, especially the two permissions.

## How it behaves

Permissions belong to the launching app: run from a Herdr terminal, `hands` is attributed to Herdr.app, so Herdr is granted Accessibility and Screen Recording once. `permissions --ask` calls `AXIsProcessTrustedWithOptions` with the prompt option and `CGRequestScreenCaptureAccess`. No helper bundle, no signing.

`see` walks `AXUIElementCreateApplication(pid)` (or one window matched by title) depth-first, skipping `AXMenuBar` unless `--menus`, capped at 5000 nodes and `--depth`, and writes a snapshot of every element (index, role, frame, title) to `~/Library/Caches/hands/snapshot-<terminal>.json` and the shared `snapshot.json` (`HANDS_STATE_DIR` overrides). Actions on element N read the snapshot, hit-test the frame centre with `AXUIElementCopyElementAtPosition`, climb parents until the role matches, refuse if role, title or description differ from the listing, then perform `AXPress`, set `AXValue`, or set `AXFocused`. When that fails they fall back to synthetic events posted with `CGEventPostToPid`: a mouse click at the centre, or for `set` click, Cmd-A and typed text. Right and double clicks always use mouse events.

`type` posts keyboard events carrying Unicode strings in 20-character chunks; `key` parses `cmd+shift+s` style chords to keys found on the active keyboard layout with UCKeyTranslate, falling back to a US table if the layout cannot be read and sets fn for arrows and function keys. `scroll` posts a line-unit scroll-wheel event at the element centre or `--at` point. The target pid is `--app` (pid, exact name or bundle id, then prefix), else the last snapshot's app, else the frontmost app. `--delay` in milliseconds sets the pause after click, set, focus, key, scroll and type before the process exits (default 500) and, on type, the pause between characters (default 8).

`shot` lists on-screen windows with `SCShareableContent`, picks the target pid's largest window (or the one whose title contains `--window`), and captures it with `SCScreenshotManager` at the display's backing scale into a PNG via ImageIO. `record start` launches `/usr/sbin/screencapture -v -x [-V seconds] [-k] file`, or with `--app` its own `record-worker` process that streams the chosen window through `SCStream` into an `AVAssetWriter` (H.264, 32BGRA frames at up to 30 fps, even dimensions), detached in its own session with SIGHUP ignored and SIGINT re-enabled so a background launch cannot leave it ignored, and stores pid, path and app in `record.json`; the worker's output goes to `record.log`, shown when no movie appears. `record stop` sends SIGINT, which the worker turns into a stop flag that ends the stream and finishes the writer, waits up to fifteen seconds and reports the file; `record status` checks the pid, treating zombies as finished.

## Built from

`hands/` holds `helper/` (`go.mod` with no requirements, `main.go`, `tree.go`, `keys.go`, `record.go`, `bridge.go`, `bridge.h`, `bridge.m`, `hands_test.go`), `mods/hands/{mod.json,main.js}`, `install.py`, `tests/` (`test_install.py`, `packaging.test.cjs`), `README.md`, `SKILL.md`, `.gitignore` for `mods/hands/bin/`. The bridge links AppKit, ApplicationServices, CoreGraphics, ScreenCaptureKit, ImageIO, UniformTypeIdentifiers and Foundation with ARC. `install.py` builds with `CGO_ENABLED=1`, copies only the runtime files and binary to `~/.config/herdr-app/mods/hands/`, runs `herdr-app check`, and symlinks `~/.local/bin/hands` unless a real file is there.

## Watch out

Accessibility access lets anything in a Herdr terminal operate every app; say so before installing. Permissions granted while a terminal is open apply to new processes only, so restart the terminal after allowing. Some apps expose elements only if Accessibility was granted before they launched. Element numbers go stale when the UI changes; `see` again. Screenshots need macOS 14 for `SCScreenshotManager`. Full-screen recording shows clicks only with `--clicks`; window recording shows no click highlights and captures nothing outside the window. No OCR, no MCP server, no daemon, no cross-platform code.

Herdr's shipped layouts are read-only, so the pane only shows in a layout the person owns; add `{ "mod": "hands" }` to a stack in their layout, or leave it out and use the CLI alone.


A `settings` block in the installed `mods/hands/mod.json` carries the person's preferences, merged over the mod's defaults by the shared `settings.js` with unknown keys and wrong types reported; the keys are listed in README.md. Durations are strings such as `60s`, sizes such as `60KB`. Version lives beside it in the same file.

## Done when

- `go test ./...` and `go vet ./...` pass in `helper/`; `python3 -m unittest discover -s tests` and `node --test tests/*.test.cjs` pass; `herdr-app check ~/.config/herdr-app/mods/hands` passes.
- From a Herdr terminal: `hands see --app Finder` prints a numbered tree; `hands click N` opens a sidebar item; `hands set` fills a text field in TextEdit; `hands shot --app Finder out.png` writes a PNG; `hands record start x.mov`, a few actions, `hands record stop` yields a playable movie.
- The root README table has a hands row and `hands/README.md` reads like the other mods'.
