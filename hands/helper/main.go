// hands gives a coding agent hands on the Mac: list apps and windows, read an
// app's accessibility tree, act on numbered elements, type, press keys,
// scroll, screenshot a window and record the screen. It is a plain CLI whose
// permissions are those of the app that launched it, normally Herdr.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const usage = `hands: a coding agent's hands on the Mac

  hands permissions [--ask[=accessibility|screen]]   permission state; --ask prompts for both or one
  hands apps                           running apps with pid, bundle id, frontmost
  hands windows [--app A]              on-screen windows with their frames
  hands see --app A [--window T]       numbered accessibility tree; saves the snapshot actions use
           [--find text] [--max N] [--depth N] [--menus]
  hands click N [--right] [--double]   press element N from the last snapshot
  hands click --at X,Y [--app A]       click a screen point
  hands set N "text"                   set element N's value (text fields: prefer this over typing)
  hands focus N                        focus element N
  hands type "text" [--app A]          type text into the app (default: last snapshot's app)
  hands key cmd+shift+s [--app A]      press a chord: letters, digits, enter, tab, esc, arrows, f1–f15
  hands scroll N --dy -3 [--dx 0]      scroll over element N (or --at X,Y); negative dy scrolls down
  hands shot --app A [--window T] out.png   screenshot one window
  hands record start out.mov [--seconds N] [--clicks]   full-screen recording via screencapture
  hands record start out.mov --app A [--window T]       record one window via ScreenCaptureKit
           [--note "what this shows"]                   a summary kept with the recording
  hands record stop | status | list
  hands actions                        what hands did lately, newest first, with any output file

  --app takes a name, bundle id or pid. --json prints machine-readable output.
  --delay MS waits that long after click, set, focus, key, scroll and type
  before returning (default 500) so the app settles between steps; on type it
  is also the pause between characters (default 8). Defaults come from the
  settings block of mods/hands/mod.json.
  Element frames are global screen points with the origin at the top left.`

var boolFlags = map[string]bool{"ask": true, "json": true, "menus": true, "right": true, "double": true, "clicks": true}

// Flags may sit anywhere: `hands click 3 --right` and `hands --json apps` both work.
func parseArgs(args []string) (map[string]string, []string) {
	opts := map[string]string{}
	var rest []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "--") || a == "--" {
			if a == "--" {
				rest = append(rest, args[i+1:]...)
				break
			}
			rest = append(rest, a)
			continue
		}
		name, value, has := strings.Cut(strings.TrimPrefix(a, "--"), "=")
		if has {
			opts[name] = value
		} else if boolFlags[name] {
			opts[name] = "true"
		} else if i+1 < len(args) {
			opts[name] = args[i+1]
			i++
		} else {
			opts[name] = ""
		}
	}
	return opts, rest
}

// delayFrom reads --delay in milliseconds, falling back to the given default.
func delayFrom(opts map[string]string, fallback time.Duration) (time.Duration, error) {
	if opts["delay"] == "" {
		return fallback, nil
	}
	ms, err := strconv.Atoi(opts["delay"])
	if err != nil || ms < 0 {
		return 0, fmt.Errorf("--delay must be a number of milliseconds, got %q", opts["delay"])
	}
	return time.Duration(ms) * time.Millisecond, nil
}

type App struct {
	Pid       int    `json:"pid"`
	Name      string `json:"name"`
	Bundle    string `json:"bundle"`
	Frontmost bool   `json:"frontmost"`
}

func listApps() ([]App, error) {
	raw, err := runningApps()
	if err != nil {
		return nil, err
	}
	b, _ := json.Marshal(raw)
	var apps []App
	return apps, json.Unmarshal(b, &apps)
}

// --app accepts a pid, an exact name or bundle id, then a prefix of either.
func resolveApp(spec string, apps []App) (App, error) {
	if pid, err := strconv.Atoi(spec); err == nil {
		for _, a := range apps {
			if a.Pid == pid {
				return a, nil
			}
		}
		return App{Pid: pid, Name: spec}, nil
	}
	s := strings.ToLower(spec)
	for _, a := range apps {
		if strings.ToLower(a.Name) == s || strings.ToLower(a.Bundle) == s {
			return a, nil
		}
	}
	for _, a := range apps {
		if strings.HasPrefix(strings.ToLower(a.Name), s) || strings.HasSuffix(strings.ToLower(a.Bundle), "."+s) {
			return a, nil
		}
	}
	return App{}, fmt.Errorf("no running app matches %q; run `hands apps`", spec)
}

// The keyboard layout APIs must be called on the process's main thread.
func init() { runtime.LockOSThread() }

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "hands:", err)
		os.Exit(1)
	}
}

func run(args []string, out *os.File) (err error) {
	opts, rest := parseArgs(args)
	if len(rest) == 0 || rest[0] == "help" || opts["help"] != "" {
		fmt.Fprintln(out, usage)
		return nil
	}
	defer func() {
		if err != nil {
			logFailure(rest, opts, err)
		}
	}()
	asJSON := opts["json"] == "true"
	prefs := loadSettings()
	settle, err := delayFrom(opts, prefs.afterAction())
	if err != nil {
		return err
	}
	// Actions wait this long before returning so the next command sees the result.
	defer func() {
		if settle > 0 && map[string]bool{"click": true, "set": true, "focus": true, "key": true, "scroll": true, "type": true}[rest[0]] {
			time.Sleep(settle)
		}
	}()
	emit := func(v any, text func() string) {
		if asJSON {
			b, _ := json.MarshalIndent(v, "", "  ")
			fmt.Fprintln(out, string(b))
		} else {
			fmt.Fprintln(out, text())
		}
	}
	number := func(s string, what string) (int, error) {
		n, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("%s must be a number, got %q", what, s)
		}
		return n, nil
	}
	targetPid := func() (int, string, error) {
		if spec := opts["app"]; spec != "" {
			apps, err := listApps()
			if err != nil {
				return 0, "", err
			}
			app, err := resolveApp(spec, apps)
			return app.Pid, app.Name, err
		}
		if s, err := loadSnapshot(); err == nil {
			return s.Pid, s.App, nil
		}
		pid := frontmostPid()
		return pid, "frontmost app", nil
	}
	point := func() (float64, float64, bool) {
		x, y, ok := strings.Cut(opts["at"], ",")
		if !ok {
			return 0, 0, false
		}
		fx, e1 := strconv.ParseFloat(strings.TrimSpace(x), 64)
		fy, e2 := strconv.ParseFloat(strings.TrimSpace(y), 64)
		return fx, fy, e1 == nil && e2 == nil
	}
	// An element number becomes its centre point and role from the snapshot.
	elementTarget := func(arg string) (Snapshot, Element, error) {
		s, err := loadSnapshot()
		if err != nil {
			return s, Element{}, err
		}
		n, err := number(arg, "element")
		if err != nil {
			return s, Element{}, err
		}
		e, err := s.element(n)
		return s, e, err
	}

	switch rest[0] {
	case "permissions":
		ask := opts["ask"]
		if ask != "" && ask != "true" && ask != "accessibility" && ask != "screen" {
			return fmt.Errorf("--ask takes accessibility or screen, got %q", ask)
		}
		v, err := permissions(ask == "true" || ask == "accessibility", ask == "true" || ask == "screen")
		if err != nil {
			return err
		}
		m := v.(map[string]any)
		emit(m, func() string {
			state := func(ok any) string {
				if ok == true {
					return "granted"
				}
				return "missing"
			}
			lines := []string{"Accessibility:    " + state(m["accessibility"]), "Screen Recording: " + state(m["screen"])}
			if m["accessibility"] != true || m["screen"] != true {
				lines = append(lines, "Run `hands permissions --ask`, then allow Herdr in System Settings › Privacy & Security. Restart the terminal afterwards.")
			}
			return strings.Join(lines, "\n")
		})
	case "apps":
		apps, err := listApps()
		if err != nil {
			return err
		}
		emit(apps, func() string {
			lines := []string{}
			for _, a := range apps {
				mark := "  "
				if a.Frontmost {
					mark = "* "
				}
				lines = append(lines, fmt.Sprintf("%s%-7d %-28s %s", mark, a.Pid, a.Name, a.Bundle))
			}
			return strings.Join(lines, "\n")
		})
	case "windows":
		raw, err := onScreenWindows()
		if err != nil {
			return err
		}
		windows := raw.([]any)
		if spec := opts["app"]; spec != "" {
			apps, err := listApps()
			if err != nil {
				return err
			}
			app, err := resolveApp(spec, apps)
			if err != nil {
				return err
			}
			filtered := []any{}
			for _, w := range windows {
				if int(w.(map[string]any)["pid"].(float64)) == app.Pid {
					filtered = append(filtered, w)
				}
			}
			windows = filtered
		}
		emit(windows, func() string {
			lines := []string{}
			for _, item := range windows {
				w := item.(map[string]any)
				lines = append(lines, fmt.Sprintf("%-7.0f %-20s %q (%.0f,%.0f %.0f×%.0f)", w["pid"], w["app"], w["title"], w["x"], w["y"], w["w"], w["h"]))
			}
			if len(lines) == 0 {
				return "No on-screen windows."
			}
			return strings.Join(lines, "\n")
		})
	case "see":
		if opts["app"] == "" {
			return errors.New("see needs --app <name|bundle|pid>")
		}
		pid, name, err := targetPid()
		if err != nil {
			return err
		}
		max, depth := prefs.See.MaxLines, prefs.See.MaxDepth
		if opts["max"] != "" {
			if max, err = number(opts["max"], "--max"); err != nil {
				return err
			}
		}
		if opts["depth"] != "" {
			if depth, err = number(opts["depth"], "--depth"); err != nil {
				return err
			}
		}
		raw, err := tree(pid, opts["window"], opts["menus"] == "true", 5000, depth)
		if err != nil {
			return err
		}
		items := elementsFrom(raw)
		snapshot := Snapshot{Pid: pid, App: name, Elements: items}
		if err := saveSnapshot(snapshot); err != nil {
			return err
		}
		emit(snapshot, func() string {
			header := fmt.Sprintf("%s (pid %d): %d elements. Act with `hands click N`, `hands set N \"text\"`.", name, pid, len(items))
			lines := allLines(items)
			if opts["find"] != "" {
				lines = findLines(items, opts["find"])
				header = fmt.Sprintf("%s (pid %d): %d elements, matches for %q starred.", name, pid, len(items), opts["find"])
			}
			return header + "\n" + strings.Join(capLines(lines, max), "\n")
		})
	case "click":
		clicks := 1
		if opts["double"] == "true" {
			clicks = 2
		}
		if x, y, ok := point(); ok {
			pid, name, err := targetPid()
			if err != nil {
				return err
			}
			v, err := click(pid, x, y, opts["right"] == "true", clicks)
			if err != nil {
				return err
			}
			logAction(Action{Action: "click", App: name, Target: fmt.Sprintf("(%.0f,%.0f)", x, y)})
			emit(v, func() string { return fmt.Sprintf("Clicked (%.0f,%.0f) in pid %d.", x, y, pid) })
			return nil
		}
		if len(rest) < 2 {
			return errors.New("click needs an element number or --at X,Y")
		}
		s, e, err := elementTarget(rest[1])
		if err != nil {
			return err
		}
		cx, cy := e.X+e.W/2, e.Y+e.H/2
		var v any
		if opts["right"] == "true" || clicks == 2 {
			v, err = click(s.Pid, cx, cy, opts["right"] == "true", clicks)
		} else {
			v, err = act(s.Pid, cx, cy, e, "press", "")
		}
		if err != nil {
			return err
		}
		logAction(Action{Action: "click", App: s.App, Target: describe(e)})
		emit(v, func() string {
			return fmt.Sprintf("Pressed %d %s %q via %s. Run `hands see` again to read the result.", e.Index, e.Role, e.Title, v.(map[string]any)["via"])
		})
	case "set", "focus":
		if len(rest) < 2 || (rest[0] == "set" && len(rest) < 3) {
			return fmt.Errorf("%s needs an element number%s", rest[0], map[bool]string{true: " and a value", false: ""}[rest[0] == "set"])
		}
		s, e, err := elementTarget(rest[1])
		if err != nil {
			return err
		}
		value := ""
		if rest[0] == "set" {
			value = strings.Join(rest[2:], " ")
		}
		v, err := act(s.Pid, e.X+e.W/2, e.Y+e.H/2, e, rest[0], value)
		if err != nil {
			return err
		}
		logAction(Action{Action: rest[0], App: s.App, Target: describe(e)})
		emit(v, func() string {
			return fmt.Sprintf("%s %d %s via %s.", strings.ToUpper(rest[0][:1])+rest[0][1:], e.Index, e.Role, v.(map[string]any)["via"])
		})
	case "type":
		if len(rest) < 2 {
			return errors.New("type needs the text to type")
		}
		pid, name, err := targetPid()
		if err != nil {
			return err
		}
		text := strings.Join(rest[1:], " ")
		between, err := delayFrom(opts, prefs.betweenKeys())
		if err != nil {
			return err
		}
		// Keycodes reach every app, Unicode text only the ones that accept it.
		var v any
		pending := []rune{}
		flush := func() error {
			if len(pending) == 0 {
				return nil
			}
			var err error
			v, err = typeText(pid, string(pending))
			pending = pending[:0]
			return err
		}
		for _, r := range text {
			code, flags, ok := keystroke(r)
			if !ok {
				pending = append(pending, r)
				continue
			}
			if err := flush(); err != nil {
				return err
			}
			var err error
			if v, err = pressKey(pid, code, flags); err != nil {
				return err
			}
			time.Sleep(between)
		}
		if err := flush(); err != nil {
			return err
		}
		logAction(Action{Action: "type", App: name, Target: fmt.Sprintf("%d characters", len([]rune(text)))})
		emit(v, func() string { return fmt.Sprintf("Typed %d characters into %s.", len([]rune(text)), name) })
	case "key":
		if len(rest) < 2 {
			return errors.New("key needs a chord such as cmd+s or enter")
		}
		pid, name, err := targetPid()
		if err != nil {
			return err
		}
		code, flags, err := parseChord(rest[1])
		if err != nil {
			return err
		}
		v, err := pressKey(pid, code, flags)
		if err != nil {
			return err
		}
		logAction(Action{Action: "key", App: name, Target: rest[1]})
		emit(v, func() string { return fmt.Sprintf("Pressed %s in %s.", rest[1], name) })
	case "scroll":
		dx, dy := 0, 0
		var err error
		if opts["dx"] != "" {
			if dx, err = number(opts["dx"], "--dx"); err != nil {
				return err
			}
		}
		if opts["dy"] != "" {
			if dy, err = number(opts["dy"], "--dy"); err != nil {
				return err
			}
		}
		if dx == 0 && dy == 0 {
			return errors.New("scroll needs --dy and/or --dx (lines; negative dy scrolls down)")
		}
		var pid int
		var app string
		x, y, ok := point()
		if ok {
			if pid, app, err = targetPid(); err != nil {
				return err
			}
		} else {
			if len(rest) < 2 {
				return errors.New("scroll needs an element number or --at X,Y")
			}
			s, e, err := elementTarget(rest[1])
			if err != nil {
				return err
			}
			pid, app, x, y = s.Pid, s.App, e.X+e.W/2, e.Y+e.H/2
		}
		v, err := scroll(pid, x, y, dx, dy)
		if err != nil {
			return err
		}
		logAction(Action{Action: "scroll", App: app, Target: fmt.Sprintf("dx=%d dy=%d", dx, dy)})
		emit(v, func() string { return fmt.Sprintf("Scrolled dx=%d dy=%d at (%.0f,%.0f).", dx, dy, x, y) })
	case "shot":
		if opts["app"] == "" || len(rest) < 2 {
			return errors.New("shot needs --app <name> and an output .png path")
		}
		pid, name, err := targetPid()
		if err != nil {
			return err
		}
		v, err := screenshot(pid, opts["window"], rest[1])
		if err != nil {
			return err
		}
		logAction(Action{Action: "shot", App: name, Target: fmt.Sprint(v.(map[string]any)["title"]), File: rest[1]})
		emit(v, func() string {
			m := v.(map[string]any)
			return fmt.Sprintf("Saved %s (%.0f×%.0f, window %q).", m["path"], m["width"], m["height"], m["title"])
		})
	case "record":
		if len(rest) < 2 {
			return errors.New("record needs start <file.mov>, stop, status or list")
		}
		switch rest[1] {
		case "start":
			seconds := 0
			var err error
			if opts["seconds"] != "" {
				if seconds, err = number(opts["seconds"], "--seconds"); err != nil {
					return err
				}
			}
			file := ""
			if len(rest) > 2 {
				file = rest[2]
			}
			pid, app := 0, ""
			if opts["app"] != "" {
				if pid, app, err = targetPid(); err != nil {
					return err
				}
			}
			r, err := startRecording(file, seconds, opts["clicks"] == "true", pid, app, opts["window"], opts["note"])
			if err != nil {
				return err
			}
			emit(r, func() string {
				what := "the screen"
				if app != "" {
					what = app
				}
				return fmt.Sprintf("Recording %s to %s (pid %d). Stop with `hands record stop`.", what, r.File, r.Pid)
			})
		case "stop":
			r, err := stopRecording(15 * time.Second)
			if err != nil {
				return err
			}
			info, _ := os.Stat(r.File)
			emit(r, func() string { return fmt.Sprintf("Saved %s (%d KB).", r.File, info.Size()/1024) })
		case "status":
			r, running := currentRecording()
			emit(map[string]any{"running": running, "file": r.File, "pid": r.Pid, "started": r.Started, "app": r.App}, func() string {
				if running {
					return fmt.Sprintf("Recording %s to %s since %s (pid %d).", map[bool]string{true: r.App, false: "the screen"}[r.App != ""], r.File, r.Started, r.Pid)
				}
				return "Not recording."
			})
		case "list":
			past := pastRecordings()
			emit(past, func() string {
				if len(past) == 0 {
					return "No recordings yet."
				}
				lines := []string{}
				for _, p := range past {
					line := fmt.Sprintf("%s  %.0fs  %d KB  %s", p.Started, p.Seconds, p.Bytes/1024, p.File)
					if p.Missing {
						line += "  (movie is gone)"
					}
					if p.Note != "" {
						line += "  " + p.Note
					}
					lines = append(lines, line)
				}
				return strings.Join(lines, "\n")
			})
		default:
			return fmt.Errorf("unknown record action %q", rest[1])
		}
	case "actions":
		past := pastActions()
		emit(past, func() string { return actionLines(past) })
	case "record-worker":
		// Internal: the detached process behind `record start --app`.
		pid, err := number(opts["pid"], "--pid")
		if err != nil || len(rest) < 2 {
			return errors.New("record-worker is started by `hands record start --app`")
		}
		seconds, _ := strconv.Atoi(opts["seconds"])
		return runRecordWorker(pid, opts["window"], rest[1], seconds, prefs.Record.FramesPerSecond)
	default:
		return fmt.Errorf("unknown command %q; run `hands --help`", rest[0])
	}
	return nil
}
