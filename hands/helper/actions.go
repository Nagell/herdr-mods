package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Action is one thing hands did to an app. It names what was touched, never
// what was typed or set, since that text can be a password.
type Action struct {
	Time    string `json:"time"`
	Action  string `json:"action"`
	App     string `json:"app,omitempty"`
	Target  string `json:"target,omitempty"`
	By      string `json:"by,omitempty"` // the terminal that asked, as Herdr names it
	Error   string `json:"error,omitempty"`
	File    string `json:"file,omitempty"`
	Missing bool   `json:"missing,omitempty"`
}

const (
	actionsFile   = "actions.jsonl"
	actionsKept   = 200
	actionsTrimAt = 256 * 1024
)

// logAction appends one line, which several terminals can do at once. A log
// that can't be written never fails the action itself.
// shortcut: an append landing during a trim can lose that one line, fine for a history; lock the file if it ever matters.
func logAction(a Action) {
	if a.Time == "" {
		a.Time = time.Now().Format(time.RFC3339)
	}
	a.By = terminalName()
	if a.File != "" {
		if abs, err := filepath.Abs(a.File); err == nil {
			a.File = abs
		}
	}
	if os.MkdirAll(stateDir(), 0o755) != nil {
		return
	}
	path := filepath.Join(stateDir(), actionsFile)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	line, _ := json.Marshal(a)
	if _, err := f.Write(append(line, '\n')); err != nil {
		return
	}
	if info, err := f.Stat(); err == nil && info.Size() > actionsTrimAt {
		trimActions(path)
	}
}

// logFailure records an action that returned an error. Its output file doesn't
// exist, so the path is only named. Error messages never quote typed text.
func logFailure(rest []string, opts map[string]string, failure error) {
	arg := func(i int) string {
		if i < len(rest) {
			return rest[i]
		}
		return ""
	}
	a := Action{Action: rest[0], App: opts["app"], Error: failure.Error()}
	element := ""
	if arg(1) != "" {
		element = "element " + arg(1)
	}
	switch rest[0] {
	case "click", "scroll":
		a.Target = element
		if opts["at"] != "" {
			a.Target = "(" + opts["at"] + ")"
		}
	case "set", "focus":
		a.Target = element
	case "type":
		a.Target = fmt.Sprintf("%d characters", len([]rune(strings.Join(rest[1:], " "))))
	case "key":
		a.Target = arg(1)
	case "shot":
		a.Target = filepath.Base(arg(1))
	case "record":
		if arg(1) != "start" && arg(1) != "stop" {
			return
		}
		a.Action, a.Target = "record "+arg(1), opts["note"]
	default:
		return
	}
	if a.App == "" {
		if s, err := loadSnapshot(); err == nil && rest[0] != "shot" && rest[0] != "record" {
			a.App = s.App
		}
	}
	logAction(a)
}

// terminalName asks Herdr what it calls this terminal, stored with the action
// so the name outlives the terminal. Outside Herdr there is none.
func terminalName() string {
	id := os.Getenv("HC_TERMINAL_ID")
	if id == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	out, err := exec.CommandContext(ctx, "hc", "get", id, "--json").Output()
	if err != nil {
		return ""
	}
	var terminal struct {
		Labels struct {
			Where string `json:"where"`
		} `json:"labels"`
	}
	_ = json.Unmarshal(out, &terminal)
	return terminal.Labels.Where
}

func trimActions(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	lines := bytes.Split(bytes.TrimSpace(b), []byte("\n"))
	if len(lines) > actionsKept {
		lines = lines[len(lines)-actionsKept:]
	}
	temp, err := os.CreateTemp(stateDir(), actionsFile+".*")
	if err != nil {
		return
	}
	defer os.Remove(temp.Name())
	_, err = temp.Write(append(bytes.Join(lines, []byte("\n")), '\n'))
	if temp.Close() == nil && err == nil {
		_ = os.Rename(temp.Name(), path)
	}
}

// pastActions lists the most recent actions, newest first, saying whose output
// file has since gone.
func pastActions() []Action {
	past := []Action{}
	b, err := os.ReadFile(filepath.Join(stateDir(), actionsFile))
	if err != nil {
		return past
	}
	lines := bytes.Split(bytes.TrimSpace(b), []byte("\n"))
	for i := len(lines) - 1; i >= 0 && len(past) < actionsKept; i-- {
		var a Action
		if json.Unmarshal(lines[i], &a) != nil {
			continue // a torn line must not hide the rest
		}
		if a.File != "" {
			_, err := os.Stat(a.File)
			a.Missing = err != nil
		}
		past = append(past, a)
	}
	return past
}

func actionLines(past []Action) string {
	if len(past) == 0 {
		return "No actions yet."
	}
	lines := []string{}
	for _, a := range past {
		parts := []string{a.Time, a.Action}
		for _, part := range []string{a.App, a.By, a.Target, a.File, a.Error} {
			if part != "" {
				parts = append(parts, part)
			}
		}
		if a.Missing {
			parts = append(parts, "(file is gone)")
		}
		lines = append(lines, strings.Join(parts, "  "))
	}
	return strings.Join(lines, "\n")
}

// describe names an element the way a person would: `Button "Save"`.
func describe(e Element) string {
	role := strings.TrimPrefix(e.Role, "AX")
	for _, name := range []string{e.Title, e.Desc, e.Placeholder} {
		if name != "" {
			return fmt.Sprintf("%s %q", role, name)
		}
	}
	return role
}
