package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func sample() []Element {
	return elementsFrom([]any{
		map[string]any{"d": 0, "role": "AXApplication", "title": "Finder", "enabled": true},
		map[string]any{"d": 1, "role": "AXWindow", "title": "Downloads", "x": 10, "y": 20, "w": 800, "h": 600, "enabled": true},
		map[string]any{"d": 2, "role": "AXButton", "desc": "close", "x": 12, "y": 22, "w": 14, "h": 14, "enabled": true},
		map[string]any{"d": 2, "role": "AXTextField", "placeholder": "Search", "value": "", "x": 600, "y": 30, "w": 150, "h": 22, "enabled": true, "focused": true},
		map[string]any{"d": 1, "role": "AXMenuBar", "enabled": false},
	})
}

func TestLinesNumberIndentAndDescribeElements(t *testing.T) {
	lines := allLines(sample())
	if len(lines) != 5 || !strings.HasPrefix(lines[1], "  1     AXWindow \"Downloads\" (10,20 800×600)") {
		t.Fatalf("lines %q", lines)
	}
	if !strings.Contains(lines[2], "[close]") || !strings.Contains(lines[3], `placeholder "Search"`) || !strings.HasSuffix(lines[3], "focused") || !strings.HasSuffix(lines[4], "disabled") {
		t.Fatalf("lines %q", lines)
	}
}

func TestFindKeepsAncestorsAndStarsMatches(t *testing.T) {
	lines := findLines(sample(), "search")
	if len(lines) != 3 || !strings.HasPrefix(lines[0], "  0") || !strings.HasPrefix(lines[1], "  1") || !strings.HasPrefix(lines[2], "* 3") {
		t.Fatalf("find %q", lines)
	}
	if got := findLines(sample(), "nothing"); len(got) != 0 {
		t.Fatalf("expected no lines, got %q", got)
	}
}

func TestCapSaysHowManyAreHidden(t *testing.T) {
	lines := capLines(allLines(sample()), 2)
	if len(lines) != 3 || lines[2] != "… 3 more lines (raise --max or narrow with --find)" {
		t.Fatalf("cap %q", lines)
	}
	if got := capLines(allLines(sample()), 0); len(got) != 5 {
		t.Fatal("zero means no cap")
	}
}

func TestSnapshotRoundTripAndBounds(t *testing.T) {
	t.Setenv("HANDS_STATE_DIR", t.TempDir())
	if _, err := loadSnapshot(); err == nil || !strings.Contains(err.Error(), "hands see") {
		t.Fatalf("expected a hint to run see, got %v", err)
	}
	if err := writeState("snapshot.json", Snapshot{Pid: 7, App: "Finder", Elements: sample()}); err != nil {
		t.Fatal(err)
	}
	s, err := loadSnapshot()
	if err != nil || s.Pid != 7 || len(s.Elements) != 5 {
		t.Fatalf("snapshot %+v %v", s, err)
	}
	if _, err := s.element(0); err == nil || !strings.Contains(err.Error(), "no position") {
		t.Fatalf("expected a frameless element to be refused, got %v", err)
	}
	if e, err := s.element(3); err != nil || e.Role != "AXTextField" || e.Index != 3 {
		t.Fatalf("element %+v %v", e, err)
	}
	if _, err := s.element(9); err == nil || !strings.Contains(err.Error(), "0–4") {
		t.Fatalf("expected a bounds error, got %v", err)
	}
}

func TestChordsMapToKeycodesAndFlags(t *testing.T) {
	code, flags, err := parseChord("cmd+shift+s")
	if err != nil || code != 1 || flags != flagCommand|flagShift {
		t.Fatalf("got %d %x %v", code, flags, err)
	}
	if code, flags, _ := parseChord("Enter"); code != 36 || flags != 0 {
		t.Fatalf("enter %d %x", code, flags)
	}
	if code, flags, _ := parseChord("ctrl+left"); code != 123 || flags != flagControl|flagFn {
		t.Fatalf("arrow %d %x", code, flags)
	}
	for _, bad := range []string{"cmd+", "cmd+a+b", "hyper"} {
		if _, _, err := parseChord(bad); err == nil {
			t.Fatalf("expected %q to fail", bad)
		}
	}
}

func TestKeystrokesCoverAsciiAndFallBackForTheRest(t *testing.T) {
	for r, want := range map[rune][2]uint64{'a': {0, 0}, 'A': {0, flagShift}, '*': {28, flagShift}, '3': {20, 0}, '\n': {36, 0}, ' ': {49, 0}} {
		code, flags, ok := keystroke(r)
		if !ok || uint64(code) != want[0] || flags != want[1] {
			t.Fatalf("%q → %d %x %v", r, code, flags, ok)
		}
	}
	if _, _, ok := keystroke('é'); ok {
		t.Fatal("non-ASCII should fall back to Unicode text")
	}
}

func TestSettingsComeFromTheManifestBesideTheBinary(t *testing.T) {
	dir := t.TempDir()
	manifest := filepath.Join(dir, "mod.json")
	t.Setenv("HANDS_MANIFEST", manifest)
	if s := loadSettings(); s.afterAction() != 500*time.Millisecond || s.See.MaxLines != 300 || s.Record.FramesPerSecond != 30 {
		t.Fatalf("defaults without a manifest: %+v", s)
	}
	os.WriteFile(manifest, []byte(`{"settings":{"pause":{"after_action":"1s","between_keys":20},"see":{"max_lines":50},"record":{"frames_per_second":999},"state_dir":"~/x"}}`), 0o644)
	s := loadSettings()
	if s.afterAction() != time.Second || s.betweenKeys() != 20*time.Millisecond || s.See.MaxLines != 50 || s.See.MaxDepth != 60 || s.Record.FramesPerSecond != 30 || s.StateDir != "~/x" {
		t.Fatalf("manifest values: %+v", s)
	}
	t.Setenv("HANDS_STATE_DIR", "")
	if !strings.HasSuffix(stateDir(), "/x") || strings.Contains(stateDir(), "~") {
		t.Fatalf("state dir %s", stateDir())
	}
	if parseDuration("nope", time.Minute) != time.Minute || parseDuration("1.5s", 0) != 1500*time.Millisecond {
		t.Fatal("durations")
	}
}

func TestManifestIsFoundThroughASymlink(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(dir, "mods/hands/bin/hands")
	os.MkdirAll(filepath.Dir(real), 0o755)
	os.WriteFile(real, nil, 0o755)
	link := filepath.Join(dir, "link-hands")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if got := manifestBeside(link); got != filepath.Join(dir, "mods/hands/mod.json") {
		t.Fatalf("got %s", got)
	}
}

func TestStopKeepsStateWhileTheRecorderLives(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	stubborn := filepath.Join(dir, "stubborn.sh")
	os.WriteFile(stubborn, []byte("#!/bin/bash\ntrap '' INT\nwhile :; do sleep 0.05; done\n"), 0o755)
	old := screencapture
	screencapture = stubborn
	t.Cleanup(func() { screencapture = old })
	r, err := startRecording(filepath.Join(dir, "out.mov"), 0, false, 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { syscall.Kill(r.Pid, syscall.SIGKILL) })
	time.Sleep(300 * time.Millisecond)
	if _, err := stopRecording(300 * time.Millisecond); err == nil {
		t.Fatal("expected stop to report the live recorder")
	}
	if _, running := currentRecording(); !running {
		t.Fatal("status must still report the live recorder")
	}
}

func TestDelayDefaultsAndRejectsNonsense(t *testing.T) {
	if d, err := delayFrom(map[string]string{}, 8*time.Millisecond); err != nil || d != 8*time.Millisecond {
		t.Fatalf("default %v %v", d, err)
	}
	if d, err := delayFrom(map[string]string{"delay": "250"}, 500*time.Millisecond); err != nil || d != 250*time.Millisecond {
		t.Fatalf("explicit %v %v", d, err)
	}
	for _, bad := range []string{"-1", "soon"} {
		if _, err := delayFrom(map[string]string{"delay": bad}, 0); err == nil {
			t.Fatalf("expected %q to fail", bad)
		}
	}
}

func TestArgsAcceptFlagsAnywhere(t *testing.T) {
	opts, rest := parseArgs([]string{"click", "3", "--right", "--app", "Finder", "--json", "--max=5"})
	if rest[0] != "click" || rest[1] != "3" || opts["right"] != "true" || opts["app"] != "Finder" || opts["json"] != "true" || opts["max"] != "5" {
		t.Fatalf("%v %v", opts, rest)
	}
	_, rest = parseArgs([]string{"type", "--", "--literal text"})
	if len(rest) != 2 || rest[1] != "--literal text" {
		t.Fatalf("double dash %v", rest)
	}
}

func TestResolveAppByPidNameBundleOrPrefix(t *testing.T) {
	apps := []App{{Pid: 1, Name: "Finder", Bundle: "com.apple.finder"}, {Pid: 2, Name: "Firefox", Bundle: "org.mozilla.firefox"}}
	for spec, want := range map[string]int{"2": 2, "finder": 1, "com.apple.finder": 1, "fire": 2} {
		if app, err := resolveApp(spec, apps); err != nil || app.Pid != want {
			t.Fatalf("%s → %+v %v", spec, app, err)
		}
	}
	if _, err := resolveApp("Mail", apps); err == nil || !strings.Contains(err.Error(), "hands apps") {
		t.Fatalf("expected a hint, got %v", err)
	}
}

func TestRecorderCommandPicksScreencaptureOrTheWindowWorker(t *testing.T) {
	program, args := recorderCommand("/tmp/a.mov", 30, true, 0, "", "/bin/hands")
	if program != screencapture || strings.Join(args, " ") != "-v -x -V 30 -k /tmp/a.mov" {
		t.Fatalf("screen: %s %v", program, args)
	}
	program, args = recorderCommand("/tmp/b.mov", 0, false, 42, "Docs", "/bin/hands")
	if program != "/bin/hands" || strings.Join(args, " ") != "record-worker --pid 42 --seconds 0 --window Docs /tmp/b.mov" {
		t.Fatalf("window: %s %v", program, args)
	}
}

func TestRecordingStartsStopsAndRefusesOverlap(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	// A stand-in for screencapture: it writes the movie when SIGINT arrives.
	fake := filepath.Join(dir, "fake-screencapture.sh")
	if err := os.WriteFile(fake, []byte("#!/bin/bash\nfile=\"${@: -1}\"\ntrap 'echo movie > \"$file\"; exit 0' INT\nwhile :; do sleep 0.05; done\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := screencapture
	screencapture = fake
	t.Cleanup(func() { screencapture = old })
	movie := filepath.Join(dir, "out.mov")
	r, err := startRecording(movie, 0, false, 0, "", "")
	if err != nil || !alive(r.Pid) {
		t.Fatalf("start %+v %v", r, err)
	}
	if _, err := startRecording(filepath.Join(dir, "two.mov"), 0, false, 0, "", ""); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("expected overlap refusal, got %v", err)
	}
	if _, running := currentRecording(); !running {
		t.Fatal("status should report running")
	}
	time.Sleep(300 * time.Millisecond) // let the script install its trap
	stopped, err := stopRecording(5 * time.Second)
	if err != nil || stopped.File != movie {
		t.Fatalf("stop %+v %v", stopped, err)
	}
	if b, _ := os.ReadFile(movie); strings.TrimSpace(string(b)) != "movie" {
		t.Fatal("the movie was not written on SIGINT")
	}
	if _, running := currentRecording(); running {
		t.Fatal("state should be cleared after stop")
	}
	if _, err := stopRecording(time.Second); err == nil {
		t.Fatal("stopping twice should fail")
	}
}
