package main

// record.go wraps /usr/sbin/screencapture -v, which ships with macOS. The
// recorder runs detached; its pid lives in a state file until `record stop`
// sends it SIGINT, which is how screencapture finalises the movie.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Recording struct {
	Pid     int    `json:"pid"`
	File    string `json:"file"`
	Started string `json:"started"`
	App     string `json:"app,omitempty"` // set for a window recording
	Window  string `json:"window,omitempty"`
	Note    string `json:"note,omitempty"`
	Ended   string `json:"ended,omitempty"`
}

// PastRecording is a finished recording plus what its movie looks like now.
type PastRecording struct {
	Recording
	Seconds float64 `json:"seconds"`
	Bytes   int64   `json:"bytes"`
	Missing bool    `json:"missing,omitempty"`
}

const historySize = 50

// remember files a finished recording, newest first. The movie's last write is
// its end, since a --seconds recording stops with nobody watching.
// shortcut: lives in the state dir, a cache folder by default, so clearing it loses the list; move it if that bites.
func remember(r Recording) {
	info, err := os.Stat(r.File)
	if err != nil {
		return
	}
	r.Ended = info.ModTime().Format(time.RFC3339)
	var old []Recording
	_ = readState("recordings.json", &old)
	list := []Recording{r}
	for _, o := range old {
		if o.File != r.File && len(list) < historySize {
			list = append(list, o)
		}
	}
	_ = writeState("recordings.json", list)
}

func pastRecordings() []PastRecording {
	currentRecording() // files one that ended by itself
	var list []Recording
	_ = readState("recordings.json", &list)
	past := []PastRecording{}
	for _, r := range list {
		p := PastRecording{Recording: r}
		started, _ := time.Parse(time.RFC3339, r.Started)
		ended, _ := time.Parse(time.RFC3339, r.Ended)
		p.Seconds = ended.Sub(started).Seconds()
		if info, err := os.Stat(r.File); err == nil {
			p.Bytes = info.Size()
		} else {
			p.Missing = true
		}
		past = append(past, p)
	}
	return past
}

var screencapture = "/usr/sbin/screencapture"

// Full-screen recordings run screencapture; a window recording runs this
// binary's own worker, which streams the window through ScreenCaptureKit.
func recorderCommand(path string, seconds int, clicks bool, pid int, window string, self string) (string, []string) {
	if pid > 0 {
		args := []string{"record-worker", "--pid", strconv.Itoa(pid), "--seconds", strconv.Itoa(seconds)}
		if window != "" {
			args = append(args, "--window", window)
		}
		return self, append(args, path)
	}
	args := []string{"-v", "-x"}
	if seconds > 0 {
		args = append(args, "-V", strconv.Itoa(seconds))
	}
	if clicks {
		args = append(args, "-k")
	}
	return screencapture, append(args, path)
}

func alive(pid int) bool {
	if pid <= 0 || syscall.Kill(pid, 0) != nil {
		return false
	}
	// A finished child nobody has reaped still answers kill(0); ps shows it as Z.
	state, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).Output()
	return err != nil || !strings.HasPrefix(strings.TrimSpace(string(state)), "Z")
}

// A pid alone may have been reused, so the process must also look like a recorder.
func isRecorder(pid int) bool {
	if !alive(pid) {
		return false
	}
	command, err := exec.Command("ps", "-o", "command=", "-p", strconv.Itoa(pid)).Output()
	return err == nil && (strings.Contains(string(command), "screencapture") || strings.Contains(string(command), "record-worker"))
}

func currentRecording() (Recording, bool) {
	var r Recording
	if err := readState("record.json", &r); err != nil {
		return r, false
	}
	if !isRecorder(r.Pid) {
		_ = os.Remove(filepath.Join(stateDir(), "record.json"))
		remember(r)
		return r, false
	}
	return r, true
}

func startRecording(file string, seconds int, clicks bool, pid int, app, window, note string) (Recording, error) {
	if r, running := currentRecording(); running {
		return r, fmt.Errorf("a recording is already running (pid %d, %s); stop it first", r.Pid, r.File)
	}
	if file == "" {
		return Recording{}, errors.New("give the movie a path, for example `hands record start demo.mov`")
	}
	path, err := filepath.Abs(file)
	if err != nil {
		return Recording{}, err
	}
	if _, err := os.Stat(path); err == nil {
		return Recording{}, fmt.Errorf("%s already exists; choose a new name", path)
	}
	self, _ := os.Executable()
	program, args := recorderCommand(path, seconds, clicks, pid, window, self)
	// A shell that launched us in the background leaves SIGINT ignored, and a
	// child inherits that; a Go handler for it makes the child start with the
	// default disposition, so `record stop` can reach the recorder.
	signal.Notify(make(chan os.Signal, 1), syscall.SIGINT)
	cmd := exec.Command(program, args...)
	// Its own session: the terminal that started it may close right away.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := os.MkdirAll(stateDir(), 0o755); err != nil {
		return Recording{}, err
	}
	// The worker's output lands in a log that `stop` shows when no movie appears.
	if log, err := os.Create(filepath.Join(stateDir(), "record.log")); err == nil {
		cmd.Stdout, cmd.Stderr = log, log
		defer log.Close()
	}
	if err := cmd.Start(); err != nil {
		return Recording{}, fmt.Errorf("could not start the recorder: %w", err)
	}
	r := Recording{Pid: cmd.Process.Pid, File: path, Started: time.Now().Format(time.RFC3339), App: app, Window: window, Note: note}
	if err := writeState("record.json", r); err != nil {
		return r, err
	}
	// Let it detach: the reaper is launchd once this process exits.
	_ = cmd.Process.Release()
	return r, nil
}

func stopRecording(wait time.Duration) (Recording, error) {
	r, running := currentRecording()
	if !running {
		return r, errors.New("no recording is running")
	}
	if err := syscall.Kill(r.Pid, syscall.SIGINT); err != nil {
		return r, err
	}
	deadline := time.Now().Add(wait)
	for alive(r.Pid) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	// Keep the state while the recorder lives, so status stays true and stop can retry.
	if alive(r.Pid) {
		return r, fmt.Errorf("the recorder (pid %d) did not exit; run `hands record stop` again", r.Pid)
	}
	_ = os.Remove(filepath.Join(stateDir(), "record.json"))
	if _, err := os.Stat(r.File); err != nil {
		log, _ := os.ReadFile(filepath.Join(stateDir(), "record.log"))
		detail := strings.TrimSpace(string(log))
		if detail == "" {
			detail = "Screen Recording access may be missing (`hands permissions --ask`)"
		}
		return r, fmt.Errorf("no movie at %s: %s", r.File, detail)
	}
	remember(r)
	return r, nil
}

// runRecordWorker is the detached process behind a window recording. It
// stops on SIGINT from `record stop` or when the time limit passes.
func runRecordWorker(pid int, window, path string, seconds, fps int) error {
	signal.Ignore(syscall.SIGHUP)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		stopRecordingWindow()
	}()
	result, err := recordWindow(pid, window, path, seconds, fps)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(result)
	fmt.Println(string(b))
	return nil
}
