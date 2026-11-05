// The run file: what a run is, and writing it safely.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"syscall"
	"time"
)

// Sends a stage's findings back to an earlier stage, then checks again, until
// there are none or Max rounds have gone.
type Loop struct {
	With string `json:"with"`
	Max  int    `json:"max"`
}

type Stage struct {
	ID      string         `json:"id"`
	Role    string         `json:"role"`
	Agent   string         `json:"agent,omitempty"`
	Model   string         `json:"model,omitempty"`
	Effort  string         `json:"effort,omitempty"`
	Message string         `json:"message,omitempty"`
	Args    []string       `json:"args,omitempty"`
	After   []string       `json:"after,omitempty"`
	Loop    *Loop          `json:"loop,omitempty"`
	Session string         `json:"session,omitempty"`
	Round   int            `json:"round,omitempty"`
	Settled bool           `json:"settled,omitempty"`
	State   string         `json:"state,omitempty"`
	Term    string         `json:"terminal,omitempty"`
	Attempt int            `json:"attempt,omitempty"`
	Summary string         `json:"summary,omitempty"`
	Counts  map[string]int `json:"counts"`
	Replies int            `json:"replies,omitempty"`
	Started string         `json:"started,omitempty"`
	Ended   string         `json:"ended,omitempty"`
}

type Event struct {
	At    string `json:"at"`
	Text  string `json:"text"`
	Stage string `json:"stage,omitempty"`
}

type Run struct {
	Orchestrator string  `json:"orchestrator,omitempty"`
	State        string  `json:"state"`
	Workflow     string  `json:"workflow,omitempty"`
	Task         string  `json:"task,omitempty"`
	Started      string  `json:"started,omitempty"`
	Ended        string  `json:"ended,omitempty"`
	Stages       []Stage `json:"stages"`
	Events       []Event `json:"events"`
	Archive      string  `json:"archive,omitempty"` // Set by history, never stored: its folder in runs/.
}

type Workflow struct {
	Description string  `json:"description"`
	Stages      []Stage `json:"stages"`
	// For the session the Run button starts. Stages have their own `args`.
	ExtraArgs []string `json:"extra_args,omitempty"`
	// Set here, never read from a file: where it came from.
	Source string `json:"source,omitempty"`
	Path   string `json:"path,omitempty"`
}

const stateDir = ".herdr-factory"

// shortcut: a fixed model for Claude stages that name none, change it here when the default should move.
const defaultClaudeModel = "claude-opus-5-5"

var (
	runPath   = filepath.Join(stateDir, "run.json")
	nonDigits = regexp.MustCompile(`[^0-9]`)
)

func now() string { return time.Now().Format("2006-01-02T15:04:05") }

func loadRun() *Run {
	run := &Run{State: "idle", Stages: []Stage{}, Events: []Event{}}
	if data, err := os.ReadFile(runPath); err == nil {
		_ = json.Unmarshal(data, run)
	}
	return run
}

// Whole files only: the sidebar reads this one on a timer.
func (r *Run) save() error {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	temp := runPath + ".tmp"
	if err := os.WriteFile(temp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temp, runPath)
}

// The sidebar and the orchestrator both write, so each command holds this for
// its whole read, change and write. It is released when the process exits.
var stateLock *os.File

func lockState() error {
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return err
	}
	// Agents read git status; the run's files are not part of the work.
	ignore := filepath.Join(stateDir, ".gitignore")
	if _, err := os.Stat(ignore); errors.Is(err, fs.ErrNotExist) {
		_ = os.WriteFile(ignore, []byte("*\n"), 0o644)
	}
	if stateLock != nil {
		stateLock.Close() // only tests run two commands in one process
	}
	var err error
	if stateLock, err = os.OpenFile(filepath.Join(stateDir, "run.lock"), os.O_CREATE|os.O_RDWR, 0o644); err != nil {
		return err
	}
	return syscall.Flock(int(stateLock.Fd()), syscall.LOCK_EX)
}

// Keeps a finished run and its result files under runs/, for the sidebar's history.
// The folder is named from digits only, since run.json is a file in the repo's folder.
// shortcut: past runs are never pruned, add a limit if a repo's folder ever grows large.
func archiveRun(r *Run) error {
	if len(r.Stages) == 0 {
		return nil
	}
	name := nonDigits.ReplaceAllString(r.Started, "")
	dir := filepath.Join(stateDir, "runs", name)
	for n := 2; ; n++ {
		if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
			break
		}
		dir = filepath.Join(stateDir, "runs", fmt.Sprintf("%s-%d", name, n))
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if resultFile.MatchString(entry.Name()) {
			if err := os.Rename(filepath.Join(stateDir, entry.Name()), filepath.Join(dir, entry.Name())); err != nil {
				return err
			}
		}
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "run.json"), data, 0o644)
}

// Past runs, newest first. No task, like everything the sidebar reads.
func pastRuns() []Run {
	runs := []Run{}
	entries, _ := os.ReadDir(filepath.Join(stateDir, "runs"))
	for _, entry := range entries {
		var r Run
		data, err := os.ReadFile(filepath.Join(stateDir, "runs", entry.Name(), "run.json"))
		if err != nil || json.Unmarshal(data, &r) != nil {
			continue
		}
		r.Archive, r.Task = entry.Name(), ""
		runs = append(runs, r)
	}
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].Started > runs[j].Started })
	return runs
}

func (r *Run) log(text, stage string) {
	r.Events = append(r.Events, Event{At: now(), Text: text, Stage: stage})
	fmt.Println(text)
}

func (r *Run) stage(id string) (*Stage, error) {
	for i := range r.Stages {
		if r.Stages[i].ID == id {
			return &r.Stages[i], nil
		}
	}
	return nil, fmt.Errorf("no stage %q in this run", id)
}

func (r *Run) end(state string) {
	r.State = state
	r.Ended = now()
	r.log("workflow "+state, "")
}

// Nothing left running means the run has stopped, however it got there.
func (r *Run) settle() {
	if r.State != "working" {
		return
	}
	for _, s := range r.Stages {
		if s.State == "working" {
			return
		}
	}
	r.end("stopped")
}
