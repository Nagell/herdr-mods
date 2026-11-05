package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Tests run off the main thread, where the layout APIs must not be called.
func init() {
	layoutLookup = func(rune) (int, bool, bool, bool) { return 0, false, false, false }
}

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

func TestStateOfAFinishedOrUnrelatedRecorderIsCleared(t *testing.T) {
	t.Setenv("HANDS_STATE_DIR", t.TempDir())
	// This test process is alive but is not a recorder.
	writeState("record.json", Recording{Pid: os.Getpid(), File: "/tmp/x.mov"})
	if _, running := currentRecording(); running {
		t.Fatal("an unrelated live pid must not count as a recording")
	}
	if _, err := os.Stat(filepath.Join(stateDir(), "record.json")); err == nil {
		t.Fatal("stale state should be removed")
	}
}

func TestEachTerminalKeepsItsOwnSnapshot(t *testing.T) {
	t.Setenv("HANDS_STATE_DIR", t.TempDir())
	t.Setenv("HC_TERMINAL_ID", "t1")
	saveSnapshot(Snapshot{Pid: 1, App: "Safari"})
	t.Setenv("HC_TERMINAL_ID", "t2")
	saveSnapshot(Snapshot{Pid: 2, App: "Mail"})
	t.Setenv("HC_TERMINAL_ID", "t1")
	if s, err := loadSnapshot(); err != nil || s.Pid != 1 {
		t.Fatalf("own snapshot: %+v %v", s, err)
	}
	t.Setenv("HC_TERMINAL_ID", "t3")
	if s, err := loadSnapshot(); err != nil || s.Pid != 2 {
		t.Fatalf("a terminal with no listing uses the latest: %+v %v", s, err)
	}
	t.Setenv("HC_TERMINAL_ID", "../evil")
	if ownSnapshotFile() != "" {
		t.Fatal("unsafe terminal ids must not name files")
	}
}

func TestKeystrokesFollowTheActiveLayout(t *testing.T) {
	old := layoutLookup
	t.Cleanup(func() { layoutLookup = old })
	// AZERTY: "a" is on the US "q" key, and "1" needs shift.
	layoutLookup = func(r rune) (int, bool, bool, bool) {
		switch r {
		case 'a':
			return 12, false, true, true
		case '1':
			return 18, true, true, true
		}
		return 0, false, false, true
	}
	if code, flags, ok := keystroke('a'); !ok || code != 12 || flags != 0 {
		t.Fatalf("a: %d %x %v", code, flags, ok)
	}
	if code, flags, err := parseChord("cmd+a"); err != nil || code != 12 || flags != flagCommand {
		t.Fatalf("cmd+a: %d %x %v", code, flags, err)
	}
	if code, flags, ok := keystroke('1'); !ok || code != 18 || flags != flagShift {
		t.Fatalf("1: %d %x %v", code, flags, ok)
	}
	if _, _, ok := keystroke('z'); ok {
		t.Fatal("a character the layout lacks must go as Unicode text")
	}
	if code, _, err := parseChord("enter"); err != nil || code != 36 {
		t.Fatalf("named keys do not depend on the layout: %d %v", code, err)
	}
}

func TestStopKeepsStateWhileTheRecorderLives(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	stubborn := filepath.Join(dir, "stubborn-screencapture.sh")
	os.WriteFile(stubborn, []byte("#!/bin/bash\ntrap '' INT\nwhile :; do sleep 0.05; done\n"), 0o755)
	old := screencapture
	screencapture = stubborn
	t.Cleanup(func() { screencapture = old })
	r, err := startRecording(filepath.Join(dir, "out.mov"), 0, false, 0, "", "", "")
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
	if d, err := delayFrom(map[string]string{}, "delay", 8*time.Millisecond); err != nil || d != 8*time.Millisecond {
		t.Fatalf("default delay %v %v", d, err)
	}
	if d, err := delayFrom(map[string]string{"delay": "250"}, "delay", 500*time.Millisecond); err != nil || d != 250*time.Millisecond {
		t.Fatalf("given delay %v %v", d, err)
	}
	for _, bad := range []string{"soon", "-1"} {
		if _, err := delayFrom(map[string]string{"delay": bad}, "delay", 0); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	// Typing has its own pause: --delay must not slow it down.
	opts := map[string]string{"delay": "1500"}
	if d, _ := delayFrom(opts, "key-delay", 100*time.Millisecond); d != 100*time.Millisecond {
		t.Fatalf("--delay changed typing: %v", d)
	}
	if d, _ := delayFrom(map[string]string{"key-delay": "20"}, "key-delay", 100*time.Millisecond); d != 20*time.Millisecond {
		t.Fatalf("--key-delay ignored: %v", d)
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
	r, err := startRecording(movie, 0, false, 0, "", "", "")
	if err != nil || !alive(r.Pid) {
		t.Fatalf("start %+v %v", r, err)
	}
	if _, err := startRecording(filepath.Join(dir, "two.mov"), 0, false, 0, "", "", ""); err == nil || !strings.Contains(err.Error(), "already running") {
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

func TestFinishedRecordingsAreRememberedNewestFirst(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	first, second := filepath.Join(dir, "one.mov"), filepath.Join(dir, "two.mov")
	if err := os.WriteFile(first, []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	started := time.Now().Add(-time.Minute).Format(time.RFC3339)
	// A recorder that ended by itself: its pid is gone, so the next look files it.
	if err := writeState("record.json", Recording{Pid: 999999, File: first, Started: started, App: "Safari", Window: "Docs", Note: "the login flow"}); err != nil {
		t.Fatal(err)
	}
	past := pastRecordings()
	if len(past) != 1 || past[0].Note != "the login flow" || past[0].Window != "Docs" || past[0].Bytes != 5 || past[0].Missing || past[0].Seconds < 55 {
		t.Fatalf("self-ended recording: %+v", past)
	}
	remember(Recording{File: second}) // no movie, nothing to remember
	if len(pastRecordings()) != 1 {
		t.Fatal("a recording without a movie was remembered")
	}
	if err := os.WriteFile(second, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	remember(Recording{File: second, Started: started})
	remember(Recording{File: second, Started: started}) // stop and the pane may both file it
	if err := os.Remove(first); err != nil {
		t.Fatal(err)
	}
	past = pastRecordings()
	if len(past) != 2 || past[0].File != second || past[1].File != first || !past[1].Missing {
		t.Fatalf("order, duplicates or missing movie: %+v", past)
	}
}

func TestActionsListNewestFirstAndSayWhenAFileIsGone(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	if got := actionLines(pastActions()); got != "No actions yet." {
		t.Fatalf("empty %q", got)
	}
	kept, gone := filepath.Join(dir, "kept.png"), filepath.Join(dir, "gone.png")
	if err := os.WriteFile(kept, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	logAction(Action{Action: "click", App: "Finder", Target: describe(Element{Role: "AXButton", Desc: "close"})})
	logAction(Action{Action: "shot", App: "Finder", File: kept})
	logAction(Action{Action: "shot", App: "Finder", File: gone})
	past := pastActions()
	if len(past) != 3 || past[0].File != gone || !past[0].Missing || past[1].Missing || past[2].Target != `Button "close"` {
		t.Fatalf("past %+v", past)
	}
}

func TestActionLogKeepsOnlyTheRecentOnes(t *testing.T) {
	t.Setenv("HANDS_STATE_DIR", t.TempDir())
	logAction(Action{Action: "first"})
	for i := 0; i < actionsKept+1; i++ {
		logAction(Action{Action: "click", Target: strings.Repeat("x", actionsTrimAt/actionsKept)})
	}
	past := pastActions()
	if len(past) != actionsKept || past[len(past)-1].Action == "first" {
		t.Fatalf("kept %d, oldest %q", len(past), past[len(past)-1].Action)
	}
}

func TestFailuresAreLoggedWithoutTheirText(t *testing.T) {
	t.Setenv("HANDS_STATE_DIR", t.TempDir())
	logFailure([]string{"type", "hunter2"}, map[string]string{"app": "Safari"}, errors.New("no such app"))
	logFailure([]string{"shot", "/tmp/out.png"}, map[string]string{"app": "Safari"}, errors.New("no window"))
	logFailure([]string{"record", "list"}, nil, errors.New("not an action"))
	logFailure([]string{"see"}, nil, errors.New("not an action"))
	past := pastActions()
	if len(past) != 2 || past[1].Target != "7 characters" || past[1].Error != "no such app" || past[0].Target != "out.png" || past[0].File != "" {
		t.Fatalf("past %+v", past)
	}
}

func TestAFinishedRecordingIsOneActionHoweverItIsFiled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HANDS_STATE_DIR", dir)
	movie := filepath.Join(dir, "m.mov")
	if err := os.WriteFile(movie, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	r := Recording{File: movie, Started: "2026-01-01T00:00:00Z", Note: "The login"}
	remember(r)
	remember(r)
	past := pastActions()
	if len(past) != 1 || past[0].Action != "record" || past[0].Target != "The login" || past[0].File != movie {
		t.Fatalf("past %+v", past)
	}
}

func TestActionsNameTheTerminalThatAsked(t *testing.T) {
	bin := t.TempDir()
	script := "#!/bin/sh\necho '{\"labels\":{\"where\":\"trailhead / Codex\"}}'\n"
	if err := os.WriteFile(filepath.Join(bin, "hc"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	t.Setenv("HC_TERMINAL_ID", "t1")
	if got := terminalName(); got != "trailhead / Codex" {
		t.Fatalf("name %q", got)
	}
	t.Setenv("HC_TERMINAL_ID", "")
	if got := terminalName(); got != "" {
		t.Fatalf("outside Herdr %q", got)
	}
}
