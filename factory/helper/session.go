// Agent sessions, through hc.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
)

func hc(args ...string) ([]byte, error) {
	cmd := exec.Command("hc", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		detail := strings.TrimSpace(stderr.String() + " " + string(out))
		return out, fmt.Errorf("hc %s: %s", args[0], detail)
	}
	return out, nil
}

func alive(terminal string) bool {
	if terminal == "" {
		return false
	}
	out, err := hc("get", terminal, "--json")
	if err != nil {
		return false
	}
	var info struct {
		State string `json:"state"`
	}
	return json.Unmarshal(out, &info) == nil && info.State == "live"
}

// An already finished session is fine: closing is what was asked for.
func closeTerminal(terminal string) error {
	if !alive(terminal) {
		return nil
	}
	_, err := hc("kill", terminal, "--json")
	return err
}

// The stage's own name. hc wants it unique among live terminals, and another
// repo may be running a `dev` too, so only then does it gain a number.
func sessionName(id string) string {
	name := id
	for n := 2; alive(name); n++ {
		name = fmt.Sprintf("%s-%d", id, n)
	}
	return name
}

// What a session can't change once it has started.
func sameLaunch(a, b *Stage) bool {
	agent := func(s *Stage) string {
		if s.Agent == "" {
			return "claude"
		}
		return s.Agent
	}
	return agent(a) == agent(b) && a.Role == b.Role && a.Model == b.Model && a.Effort == b.Effort && slices.Equal(a.Args, b.Args)
}

func launchArgs(s *Stage, role, message string, run *Run, cwd string) ([]string, error) {
	agent := s.Agent
	if agent == "" {
		agent = "claude"
	}
	program, err := exec.LookPath(agent)
	if err != nil {
		return nil, fmt.Errorf("%s is not on PATH", agent)
	}
	name := sessionName(s.ID)
	// A stage keeps working if the orchestrator's session goes, so continue can reuse it.
	args := []string{"run", "--bg", "--json", "--name", name, "--cwd", cwd, "--outlive-parent", "--parent", run.Orchestrator, program}
	if s.Model != "" {
		args = append(args, "--model", s.Model)
	}
	if agent == "claude" {
		if s.Effort != "" {
			args = append(args, "--effort", s.Effort)
		}
		// Only what the result contract needs, so it never waits on a prompt to report.
		args = append(args, "--append-system-prompt", role, "--allowedTools", "Bash(hc send:*) Write(.herdr-factory/**)")
	} else {
		if s.Effort != "" {
			args = append(args, "-c", "model_reasoning_effort="+strconv.Quote(s.Effort))
		}
		args = append(args, "-c", "developer_instructions="+strconv.Quote(role))
	}
	args = append(args, s.Args...)
	// `--`: a flag taking several values, like --allowedTools, would swallow the message.
	return append(args, "--", message), nil
}

func stageMessage(s *Stage, task string) string {
	if s.Message != "" {
		return strings.ReplaceAll(s.Message, "{task}", task)
	}
	if s.Role == "reviewer" {
		return "Review the uncommitted changes made for this task: " + task
	}
	return task
}

// Sends the stage its message and records the attempt. The session it reports
// to is the orchestrator, so a stage cannot start without a live one.
func start(run *Run, s *Stage, task string) error {
	if run.State == "paused" {
		return errors.New("the run is paused: resume it first")
	}
	if !alive(run.Orchestrator) {
		return errors.New("Factory's session is gone: continue the run from a Claude session first")
	}
	attempt := s.Attempt + 1
	if task == "" {
		task = stageMessage(s, run.Task)
		if s.Attempt > 0 {
			task += "\n\nThe work may have changed since your last attempt, so look at its current state."
		}
	}
	message := fmt.Sprintf("%s\n\nWhen done, write .herdr-factory/%s-%d.json as your role instructions say, with a summary in plain words that names no finding by its id, then run exactly this, alone and chained to nothing, so it needs no permission: hc send %s '%s done'. Then stop.",
		task, s.ID, attempt, run.Orchestrator, s.ID)
	if alive(s.Term) {
		// Only a session kept from the last run is live before its first attempt.
		if s.Attempt == 0 {
			message = "A new run starts here. Your earlier messages were for the last run; this is your task now.\n\n" + message
		}
		if _, err := hc("send", s.Term, message, "--json"); err != nil {
			return err
		}
	} else {
		role, err := roleBody(s.Role)
		if err != nil {
			return err
		}
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		args, err := launchArgs(s, role, message, run, cwd)
		if err != nil {
			return err
		}
		out, err := hc(args...)
		if err != nil {
			return err
		}
		var info struct {
			Address string `json:"address"`
		}
		if err := json.Unmarshal(out, &info); err != nil || info.Address == "" {
			return fmt.Errorf("hc run gave no address: %s", out)
		}
		s.Term = info.Address
	}
	s.State, s.Attempt, s.Started, s.Ended, s.Summary, s.Counts, s.Replies = "working", attempt, now(), "", "", nil, 0
	run.State, run.Ended = "working", ""
	run.log(fmt.Sprintf("%s started (attempt %d)", s.ID, attempt), s.ID)
	return nil
}

// Best effort: no Herdr window, or an older herdr-app, only loses the name.
func renameTab(name string) {
	me := os.Getenv("HC_TERMINAL_ID")
	out, err := exec.Command("herdr-app", "ls").Output()
	if me == "" || err != nil {
		return
	}
	var listing struct {
		Spaces []struct {
			Tabs []struct {
				ID        string `json:"id"`
				Terminals []struct {
					Terminal string `json:"terminal"`
				} `json:"terminals"`
			} `json:"tabs"`
		} `json:"spaces"`
	}
	if json.Unmarshal(out, &listing) != nil {
		return
	}
	for _, space := range listing.Spaces {
		for _, tab := range space.Tabs {
			for _, t := range tab.Terminals {
				if t.Terminal == me {
					_ = exec.Command("herdr-app", "do", "tab.rename", "--id", tab.ID, "--name", name).Run()
					return
				}
			}
		}
	}
}
