// factory records a workflow run in .herdr-factory/run.json and controls its stage
// sessions through hc. The orchestrator (a Claude session running /factory)
// and the sidebar both call it from the repo root, so it is the only
// writer of that file. Everything is standard library, built on the person's machine by helper/install.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const usage = `factory: record and control a Herdr workflow, from the repo root.

  factory list [--json]                 workflows available here
  factory status [--json]               the run
  factory run <workflow> "<task>"       begin a run; this terminal is the orchestrator
  factory continue                      pick a stopped or abandoned run back up, as orchestrator
  factory start <stage>                 send a stage its message (attempt +1), reusing a live session
  factory next                          start the next unfinished stage, or finish the run
  factory stage <stage> done            read the stage's result file and record it
  factory stage <stage> failed|working|stopped
  factory rerun <stage>                 start it again and queue the stages after it
  factory followup <stage> "<task>"     give it new work in its live session, reopening the run
  factory close <stage>                 end its session
  factory stop [--orchestrator]         end every stage session and stop the run
  factory done|stopped|failed           the run ended
  factory event "<text>"                a free note in the log
  factory tools [--json]                programs this needs that are not on PATH
  factory init                          write the default config and templates if missing
`

func printJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}

func cmdList(args []string) error {
	workflows, err := availableWorkflows()
	if err != nil {
		return err
	}
	names := make([]string, 0, len(workflows))
	for name := range workflows {
		names = append(names, name)
	}
	sort.Strings(names)
	if hasFlag(args, "--json") {
		type item struct {
			Name string `json:"name"`
			Workflow
		}
		items := []item{}
		for _, name := range names {
			items = append(items, item{name, workflows[name]})
		}
		return printJSON(items)
	}
	for _, name := range names {
		fmt.Printf("%s: %s\n", name, workflows[name].Description)
	}
	return nil
}

// What the panel warns about before anything fails partway through a run.
func cmdTools(args []string) error {
	missing := []string{}
	for _, program := range []string{"hc", "claude"} {
		if _, err := exec.LookPath(program); err != nil {
			missing = append(missing, program)
		}
	}
	if hasFlag(args, "--json") {
		return printJSON(map[string][]string{"missing": missing})
	}
	if len(missing) > 0 {
		fmt.Println("missing: " + strings.Join(missing, ", "))
	}
	return nil
}

func cmdStatus(args []string) error {
	run := loadRun()
	if hasFlag(args, "--json") {
		return printJSON(run)
	}
	stages := make([][]string, 0, len(run.Stages))
	for _, s := range run.Stages {
		stages = append(stages, []string{s.ID, s.State, s.Term})
	}
	return printJSON(map[string]any{"state": run.State, "workflow": run.Workflow, "task": run.Task, "orchestrator": run.Orchestrator, "stages": stages})
}

func cmdRun(run *Run, args []string) error {
	if len(args) < 2 {
		return errors.New(`usage: factory run <workflow> "<task>"`)
	}
	workflows, err := availableWorkflows()
	if err != nil {
		return err
	}
	name, task := args[0], strings.Join(args[1:], " ")
	workflow, ok := workflows[name]
	if !ok {
		return fmt.Errorf("no workflow %q; see factory list", name)
	}
	me := os.Getenv("HC_TERMINAL_ID")
	if me == "" {
		return errors.New("run this from an hc terminal: the session that runs it becomes the orchestrator")
	}
	for _, s := range run.Stages {
		if run.State == "working" && (s.State == "working") {
			return fmt.Errorf("stage %s is still running: factory stop first", s.ID)
		}
	}
	// A stale result file would count as this run's stage being done.
	if entries, err := os.ReadDir(stateDir); err == nil {
		for _, entry := range entries {
			if resultFile.MatchString(entry.Name()) {
				_ = os.Remove(filepath.Join(stateDir, entry.Name()))
			}
		}
	}
	// The last run's sessions hold the last task's context, and would otherwise
	// stay running under the names this run's stages need.
	for _, s := range run.Stages {
		if err := closeTerminal(s.Term); err != nil {
			return err
		}
	}
	stages := workflow.Stages
	for i := range stages {
		stages[i].State = "queued"
		// Recorded by name, so a run always says exactly which model does the work.
		if stages[i].Model == "" && stages[i].Agent != "codex" {
			stages[i].Model = defaultClaudeModel
		}
	}
	*run = Run{Orchestrator: me, State: "working", Workflow: name, Task: task, Started: now(), Stages: stages, Events: []Event{}}
	run.log("run "+name, "") // no task: the sidebar shows this log, and it never shows a prompt
	renameTab("Factory")
	return run.save()
}

func cmdContinue(run *Run) error {
	if len(run.Stages) == 0 {
		return errors.New("nothing to continue: no run here")
	}
	if run.State == "done" {
		return errors.New("the last run finished; start a new one")
	}
	me := os.Getenv("HC_TERMINAL_ID")
	if me == "" {
		return errors.New("run this from an hc terminal: the session that runs it becomes the orchestrator")
	}
	first := ""
	for i := range run.Stages {
		s := &run.Stages[i]
		if s.State == "done" {
			continue
		}
		if first == "" {
			first = s.ID
		}
		// `terminal` stays: factory start reuses the session if it is still alive.
		s.State = "queued"
	}
	run.Orchestrator, run.State, run.Ended = me, "working", ""
	run.log("continued from "+first, "")
	renameTab("Factory")
	return run.save()
}

func cmdStage(run *Run, args []string) error {
	if len(args) != 2 {
		return errors.New(usage)
	}
	s, err := run.stage(args[0])
	if err != nil {
		return err
	}
	switch args[1] {
	case "done":
		if err := recordResult(run, s); err != nil {
			return err
		}
	case "failed", "working", "stopped":
		s.State = args[1]
		if args[1] == "failed" || args[1] == "stopped" {
			s.Ended = now()
		}
		run.log(s.ID+" "+args[1], s.ID)
	default:
		return errors.New(usage)
	}
	return run.save()
}

func recordResult(run *Run, s *Stage) error {
	path := filepath.Join(stateDir, fmt.Sprintf("%s-%d.json", s.ID, s.Attempt))
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("%s is missing; the agent must write it first", path)
	}
	var result struct {
		Summary  string `json:"summary"`
		Findings []struct {
			Severity string `json:"severity"`
		} `json:"findings"`
		Replies map[string]any `json:"replies"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("%s is not valid JSON: %w", path, err)
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(data, &raw)
	s.State, s.Ended, s.Summary, s.Replies, s.Counts = "done", now(), result.Summary, len(result.Replies), nil
	text := result.Summary
	if text == "" {
		text = "done"
	}
	if _, reviewer := raw["findings"]; reviewer {
		// A reviewer: the sidebar shows counts by severity, not the summary.
		s.Counts = map[string]int{}
		for _, f := range result.Findings {
			s.Counts[f.Severity]++
		}
		parts := []string{}
		for _, severity := range severities {
			if n := s.Counts[severity]; n > 0 {
				parts = append(parts, fmt.Sprintf("%d %s", n, severity))
			}
		}
		text = strings.Join(parts, ", ")
		if text == "" {
			text = "approved"
		}
	} else if s.Replies > 0 {
		text += fmt.Sprintf(" (addressed %d)", s.Replies)
	}
	run.log(s.ID+" done: "+text, s.ID)
	return nil
}

func cmdNext(run *Run) error {
	if run.State != "working" {
		fmt.Println("the run is " + run.State + ": nothing to start")
		return nil
	}
	for i := range run.Stages {
		s := &run.Stages[i]
		switch s.State {
		case "done":
			sent, err := loopBack(run, s)
			if err != nil {
				return err
			}
			if !sent {
				continue
			}
		case "queued":
			if err := start(run, s, ""); err != nil {
				return err
			}
		default:
			fmt.Printf("%s is %s: nothing to start\n", s.ID, s.State)
		}
		return run.save()
	}
	run.end("done")
	return run.save()
}

// If a looping stage still has findings and rounds left, its partner gets them,
// and it waits to check again. Reports true if that happened.
func loopBack(run *Run, s *Stage) (bool, error) {
	if s.Loop == nil || s.Settled {
		return false, nil
	}
	open := 0
	for _, n := range s.Counts {
		open += n
	}
	if open == 0 {
		s.Settled = true
		return false, nil
	}
	if s.Round >= s.Loop.Max {
		s.Settled = true
		run.log(fmt.Sprintf("%s stopped after round %d with %d open", s.ID, s.Round, open), s.ID)
		return false, nil
	}
	partner, err := run.stage(s.Loop.With)
	if err != nil {
		return false, err
	}
	task := fmt.Sprintf("Address the findings in .herdr-factory/%s-%d.json: change the code for each one, or say why not in your JSON `replies`.", s.ID, s.Attempt)
	if err := start(run, partner, task); err != nil {
		return false, err
	}
	s.Round++
	s.State = "queued"
	run.log(fmt.Sprintf("%s round %d of %d: findings back to %s", s.ID, s.Round, s.Loop.Max, partner.ID), s.ID)
	return true, nil
}

func cmdRerun(run *Run, s *Stage, task string) error {
	if !alive(run.Orchestrator) {
		return errors.New("Factory's session is gone: continue the run from a Claude session first")
	}
	if err := start(run, s, task); err != nil {
		return err
	}
	// Their results described the old work, so they run again after this one.
	later := false
	for i := range run.Stages {
		if later {
			run.Stages[i].State = "queued"
		}
		// New work earns a loop its rounds back.
		if later || run.Stages[i].ID == s.ID {
			run.Stages[i].Round, run.Stages[i].Settled = 0, false
		}
		later = later || run.Stages[i].ID == s.ID
	}
	return run.save()
}

// New work for a stage of the last run, finished or not: its live session keeps
// what it knows, and whoever asks is who it reports to. A new session starts only
// if that one is gone. The task stays out of the log, which the sidebar shows.
func cmdFollowup(run *Run, args []string) error {
	if len(args) < 2 {
		return errors.New(`usage: factory followup <stage> "<task>"`)
	}
	s, err := run.stage(args[0])
	if err != nil {
		return err
	}
	for _, other := range run.Stages {
		if other.State == "working" {
			return fmt.Errorf("stage %s is still running: wait for it or stop it first", other.ID)
		}
	}
	if me := os.Getenv("HC_TERMINAL_ID"); me != "" && me != run.Orchestrator {
		run.Orchestrator = me
		renameTab("Factory")
	}
	task := strings.Join(args[1:], " ")
	// Later stages build their message from the run's task, so without this a reviewer
	// would judge the follow-up against the original request and call it out of scope.
	run.Task += "\n\nFollow-up, also requested: " + task
	return cmdRerun(run, s, task)
}

func cmdStop(run *Run, args []string) error {
	for i := range run.Stages {
		s := &run.Stages[i]
		if err := closeTerminal(s.Term); err != nil {
			return err
		}
		s.Term = ""
		if s.State == "working" {
			s.State, s.Ended = "stopped", now()
			run.log(s.ID+" stopped", s.ID)
		}
	}
	if run.State != "done" {
		run.end("stopped")
	}
	if hasFlag(args, "--orchestrator") {
		if err := closeTerminal(run.Orchestrator); err != nil {
			return err
		}
	}
	return run.save()
}

func stageCommand(run *Run, name string, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: factory %s <stage>", name)
	}
	s, err := run.stage(args[0])
	if err != nil {
		return err
	}
	switch name {
	case "start":
		if err := start(run, s, ""); err != nil {
			return err
		}
		return run.save()
	case "rerun":
		return cmdRerun(run, s, "")
	case "close":
		if err := closeTerminal(s.Term); err != nil {
			return err
		}
		s.Term = ""
		if s.State == "working" {
			s.State, s.Ended = "stopped", now()
		}
		run.log(s.ID+" session closed", s.ID)
		run.settle()
	}
	return run.save()
}

func dispatch(args []string) error {
	command := "status"
	if len(args) > 0 {
		command, args = args[0], args[1:]
	}
	switch command {
	case "help", "-h", "--help":
		fmt.Print(usage)
		return nil
	case "list":
		return cmdList(args)
	case "status":
		return cmdStatus(args)
	case "tools":
		return cmdTools(args)
	case "init":
		return initConfig()
	}
	if err := lockState(); err != nil {
		return err
	}
	run := loadRun()
	switch command {
	case "run":
		return cmdRun(run, args)
	case "continue":
		return cmdContinue(run)
	case "stage":
		return cmdStage(run, args)
	case "next":
		return cmdNext(run)
	case "start", "rerun", "close":
		return stageCommand(run, command, args)
	case "followup":
		return cmdFollowup(run, args)
	case "stop":
		return cmdStop(run, args)
	case "done", "stopped", "failed":
		run.end(command)
		return run.save()
	case "event":
		if len(args) == 0 {
			return errors.New(usage)
		}
		run.log(strings.Join(args, " "), "")
		return run.save()
	}
	return errors.New(usage)
}

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, strings.TrimSpace(err.Error()))
		os.Exit(1)
	}
}
