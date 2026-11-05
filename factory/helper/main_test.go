package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// A stand-in hc: logs its arguments, answers `run` with an address, and treats
// the terminals named in $HC_LIVE as live.
const fakeHC = `#!/bin/sh
echo "$*" >> "$HC_LOG"
case "$1" in
run) echo '{"address":"t9"}' ;;
get) case " $HC_LIVE " in *" $2 "*) echo '{"state":"live"}' ;; *) echo '{"state":"finished"}' ;; esac ;;
*) echo '{}' ;;
esac
`

func setup(t *testing.T, live string) string {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	repo := filepath.Join(dir, "repo")
	for _, d := range []string{bin, repo} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range map[string]string{"hc": fakeHC, "claude": "#!/bin/sh\n", "herdr-app": "#!/bin/sh\nexit 1\n"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	log := filepath.Join(dir, "hc.log")
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	t.Setenv("HC_LOG", log)
	t.Setenv("HC_LIVE", live)
	t.Setenv("HC_TERMINAL_ID", "t1")
	t.Setenv("FACTORY_CONFIG_DIR", filepath.Join(dir, "config"))
	previous, _ := os.Getwd()
	if err := os.Chdir(repo); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previous) })
	return log
}

func must(t *testing.T, args ...string) {
	t.Helper()
	if err := dispatch(args); err != nil {
		t.Fatalf("factory %v: %v", args, err)
	}
}

func hcLog(t *testing.T, path string) string {
	t.Helper()
	data, _ := os.ReadFile(path)
	return string(data)
}

func writeResult(t *testing.T, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(stateDir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestInitWritesDefaultsAndKeepsEdits(t *testing.T) {
	setup(t, "")
	must(t, "init")
	path := filepath.Join(configDir(), "workflow.json")
	if _, err := os.Stat(filepath.Join(configDir(), "templates", "developer.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"workflows":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	must(t, "init")
	if data, _ := os.ReadFile(path); string(data) != `{"workflows":{}}` {
		t.Fatalf("init overwrote the config: %s", data)
	}
}

func TestAWholeRunReportsToItsOrchestrator(t *testing.T) {
	log := setup(t, "t1")
	must(t, "run", "implement", "add", "a", "flag")
	must(t, "next")
	run := loadRun()
	dev, _ := run.stage("dev")
	if dev.State != "working" || dev.Attempt != 1 || dev.Term != "t9" {
		t.Fatalf("dev %+v", dev)
	}
	called := hcLog(t, log)
	for _, want := range []string{"--parent t1", "--outlive-parent", "--effort medium", "--permission-mode acceptEdits", "-- add a flag", "write .herdr-factory/dev-1.json", "hc send t1 'dev done'"} {
		if !strings.Contains(called, want) {
			t.Fatalf("hc run lacks %q: %s", want, called)
		}
	}
	if err := dispatch([]string{"stage", "dev", "done"}); err == nil {
		t.Fatal("done without a result file must fail")
	}
	writeResult(t, "dev-1.json", `{"summary":"Added it","replies":{"r1":"fixed"}}`)
	must(t, "stage", "dev", "done")
	must(t, "next")
	writeResult(t, "review-1.json", `{"summary":"ok","findings":[{"severity":"high"},{"severity":"low"},{"severity":"low"}]}`)
	must(t, "stage", "review", "done")
	run = loadRun()
	review, _ := run.stage("review")
	if review.Counts["high"] != 1 || review.Counts["low"] != 2 {
		t.Fatalf("run %+v", run)
	}
	must(t, "next") // the default implement loops the findings back to dev
	writeResult(t, "dev-2.json", `{"summary":"fixed"}`)
	must(t, "stage", "dev", "done")
	must(t, "next")
	writeResult(t, "review-2.json", `{"summary":"ok","findings":[]}`)
	must(t, "stage", "review", "done")
	must(t, "next")
	run = loadRun()
	if run.State != "done" {
		t.Fatalf("run %+v", run)
	}
	var events []string
	for _, e := range run.Events {
		events = append(events, e.Text)
	}
	if text := strings.Join(events, "|"); !strings.Contains(text, "dev done: Added it (addressed 1)") || !strings.Contains(text, "review done: 1 high, 2 low") {
		t.Fatalf("events %s", text)
	}
}

func TestASessionIsNamedAfterItsStageUnlessTaken(t *testing.T) {
	log := setup(t, "t1")
	must(t, "run", "implement", "x")
	must(t, "next")
	if !strings.Contains(hcLog(t, log), "--name dev --cwd") {
		t.Fatal(hcLog(t, log))
	}
	if sessionName("dev") != "dev" {
		t.Fatal("a free name must stay as it is")
	}
	t.Setenv("HC_LIVE", "dev dev-2")
	if got := sessionName("dev"); got != "dev-3" {
		t.Fatal(got)
	}
}

func TestTheLogNeverHoldsTheTask(t *testing.T) {
	setup(t, "t1")
	must(t, "run", "implement", "secret", "task")
	must(t, "next")
	for _, e := range loadRun().Events {
		if strings.Contains(e.Text, "secret") {
			t.Fatal(e.Text)
		}
	}
}

func TestAReviewerWithNoFindingsApproves(t *testing.T) {
	setup(t, "t1")
	must(t, "run", "review", "x")
	must(t, "next")
	writeResult(t, "review-1.json", `{"summary":"fine","findings":[]}`)
	must(t, "stage", "review", "done")
	run := loadRun()
	if last := run.Events[len(run.Events)-1].Text; last != "review done: approved" {
		t.Fatal(last)
	}
	// The sidebar tells a reviewer by its counts, so an empty set must survive the file.
	data, _ := os.ReadFile(runPath)
	if !strings.Contains(string(data), `"counts": {}`) {
		t.Fatal(string(data))
	}
}

func TestCloseAndStop(t *testing.T) {
	log := setup(t, "t1 t9")
	must(t, "run", "implement", "x")
	must(t, "next")
	must(t, "close", "dev")
	run := loadRun()
	s, _ := run.stage("dev")
	if s.State != "stopped" || s.Term != "" || run.State != "stopped" || !strings.Contains(hcLog(t, log), "kill t9") {
		t.Fatalf("close: %+v run %s", s, run.State)
	}
}

func TestToolsNamesWhatIsMissing(t *testing.T) {
	setup(t, "")
	t.Setenv("PATH", t.TempDir())
	must(t, "tools", "--json")
	if err := dispatch([]string{"tools"}); err != nil {
		t.Fatal(err)
	}
}

func TestStopEndsSessionsAndOnlyTheOrchestratorWhenAsked(t *testing.T) {
	log := setup(t, "t1 t9")
	must(t, "run", "implement", "x")
	must(t, "next")
	must(t, "stop")
	run := loadRun()
	if run.State != "stopped" || strings.Contains(hcLog(t, log), "kill t1") || !strings.Contains(hcLog(t, log), "kill t9") {
		t.Fatalf("stop: %s %s", run.State, hcLog(t, log))
	}
	must(t, "next") // a report arriving after a stop starts nothing
	if s, _ := loadRun().stage("review"); s.State != "queued" {
		t.Fatal(s.State)
	}
	must(t, "stop", "--orchestrator")
	if !strings.Contains(hcLog(t, log), "kill t1") {
		t.Fatal(hcLog(t, log))
	}
}

func TestRerunReusesTheSessionAndQueuesLaterStages(t *testing.T) {
	log := setup(t, "t1 t9")
	must(t, "run", "implement", "x")
	must(t, "next")
	writeResult(t, "dev-1.json", `{"summary":"one"}`)
	must(t, "stage", "dev", "done")
	must(t, "next")
	writeResult(t, "review-1.json", `{"findings":[]}`)
	must(t, "stage", "review", "done")
	must(t, "next")
	must(t, "rerun", "dev")
	run := loadRun()
	dev, _ := run.stage("dev")
	review, _ := run.stage("review")
	if run.State != "working" || dev.Attempt != 2 || dev.Summary != "" || review.State != "queued" {
		t.Fatalf("rerun: %+v", run)
	}
	if !strings.Contains(hcLog(t, log), "send t9 x") || !strings.Contains(hcLog(t, log), "dev-2.json") {
		t.Fatal(hcLog(t, log))
	}
}

// A finished implement run whose sessions are still live.
func finishedRun(t *testing.T) {
	t.Helper()
	must(t, "run", "implement", "x")
	must(t, "next")
	writeResult(t, "dev-1.json", `{"summary":"one"}`)
	must(t, "stage", "dev", "done")
	must(t, "next")
	writeResult(t, "review-1.json", `{"findings":[]}`)
	must(t, "stage", "review", "done")
	must(t, "next")
}

func TestFollowupReopensARunInTheLiveSessions(t *testing.T) {
	log := setup(t, "t1 t9")
	finishedRun(t)
	must(t, "followup", "dev", "fix", "the", "findings", "in", "review-1.json")
	run := loadRun()
	dev, _ := run.stage("dev")
	review, _ := run.stage("review")
	if run.State != "working" || run.Ended != "" || dev.State != "working" || dev.Attempt != 2 || dev.Term != "t9" || review.State != "queued" {
		t.Fatalf("followup: %+v", run)
	}
	called := hcLog(t, log)
	if !strings.Contains(called, "send t9 fix the findings in review-1.json") || !strings.Contains(called, "dev-2.json") || strings.Contains(called, "dev-2 ") {
		t.Fatal(called)
	}
	if strings.Count(called, "run --bg") != 2 {
		t.Fatalf("a follow-up must not start a session: %s", called)
	}
	for _, e := range run.Events {
		if strings.Contains(e.Text, "findings") {
			t.Fatal(e.Text)
		}
	}
	// The re-review goes to the review session that is already there.
	writeResult(t, "dev-2.json", `{"summary":"fixed"}`)
	must(t, "stage", "dev", "done")
	must(t, "next")
	called = hcLog(t, log)
	if strings.Count(called, "run --bg") != 2 || !strings.Contains(called, "review-2.json") || !strings.Contains(called, "look at its current state") {
		t.Fatal(called)
	}
}

func TestAFollowupIsPartOfWhatLaterStagesAreToldToCheck(t *testing.T) {
	log := setup(t, "t1 t9")
	must(t, "run", "review", "original task")
	must(t, "next")
	if err := os.WriteFile(filepath.Join(stateDir, "review-1.json"), []byte(`{"summary":"ok","findings":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	must(t, "stage", "review", "done")
	must(t, "followup", "review", "also check subtract")
	task := loadRun().Task
	if !strings.Contains(task, "original task") || !strings.Contains(task, "also check subtract") {
		t.Fatal(task)
	}
	for _, event := range loadRun().Events {
		if strings.Contains(event.Text, "subtract") {
			t.Fatalf("the log shows it: %s", event.Text)
		}
	}
	_ = log
}

func TestFollowupStartsASessionOnlyIfItsIsGone(t *testing.T) {
	log := setup(t, "t1")
	finishedRun(t)
	must(t, "followup", "dev", "fix it")
	if called := hcLog(t, log); strings.Count(called, "run --bg") != 3 || !strings.Contains(called, "-- fix it") {
		t.Fatal(called)
	}
}

func TestFollowupWaitsForARunningStage(t *testing.T) {
	setup(t, "t1 t9")
	must(t, "run", "implement", "x")
	must(t, "next")
	if err := dispatch([]string{"followup", "review", "more"}); err == nil || !strings.Contains(err.Error(), "still running") {
		t.Fatal(err)
	}
	if err := dispatch([]string{"followup", "dev"}); err == nil {
		t.Fatal("a follow-up needs a task")
	}
}

func TestFollowupMakesTheCallerTheOneReportedTo(t *testing.T) {
	log := setup(t, "t1 t2 t9")
	finishedRun(t)
	t.Setenv("HC_TERMINAL_ID", "t2")
	must(t, "followup", "dev", "fix it")
	if run := loadRun(); run.Orchestrator != "t2" || !strings.Contains(hcLog(t, log), "hc send t2 'dev done'") {
		t.Fatalf("%s %s", run.Orchestrator, hcLog(t, log))
	}
}

func TestANewRunEndsTheLastRunsSessionsAndNamesItsModel(t *testing.T) {
	log := setup(t, "t1 t9")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", `{"workflows":{"w":{"stages":[{"id":"a","role":"developer"},{"id":"b","role":"reviewer","agent":"codex"}]}}}`)
	finishedRun(t)
	must(t, "run", "w", "next task")
	run := loadRun()
	a, _ := run.stage("a")
	b, _ := run.stage("b")
	if a.Model != defaultClaudeModel || b.Model != "" {
		t.Fatalf("%+v %+v", a, b)
	}
	if !strings.Contains(hcLog(t, log), "kill t9") || strings.Contains(hcLog(t, log), "kill t1") {
		t.Fatal(hcLog(t, log))
	}
}

const loopConfig = `{"workflows":{"w":{"stages":[
 {"id":"dev","role":"developer"},
 {"id":"review","role":"reviewer","loop":{"with":"dev","max":2}},
 {"id":"style","role":"reviewer","message":"Check {task}","loop":{"with":"dev","max":1}}]}}}`

// One stage reports, then the orchestrator's next step.
func report(t *testing.T, stage string, attempt int, result string) {
	t.Helper()
	writeResult(t, stage+"-"+strconv.Itoa(attempt)+".json", result)
	must(t, "stage", stage, "done")
	must(t, "next")
}

func TestReviewLoopsWithDevUntilApprovedThenStyleLoops(t *testing.T) {
	log := setup(t, "t1 t9")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", loopConfig)
	must(t, "run", "w", "x")
	must(t, "next")
	report(t, "dev", 1, `{"summary":"one"}`)
	report(t, "review", 1, `{"findings":[{"severity":"high"}]}`)
	run := loadRun()
	dev, _ := run.stage("dev")
	review, _ := run.stage("review")
	if dev.State != "working" || dev.Attempt != 2 || review.State != "queued" || review.Round != 1 {
		t.Fatalf("after findings: %+v %+v", dev, review)
	}
	if !strings.Contains(hcLog(t, log), "Address the findings in .herdr-factory/review-1.json") {
		t.Fatal(hcLog(t, log))
	}
	report(t, "dev", 2, `{"summary":"fixed"}`)
	if r, _ := loadRun().stage("review"); r.State != "working" || r.Attempt != 2 {
		t.Fatalf("recheck: %+v", r)
	}
	report(t, "review", 2, `{"findings":[]}`)
	run = loadRun()
	if s, _ := run.stage("style"); s.State != "working" || s.Attempt != 1 {
		t.Fatalf("style after approval: %+v", s)
	}
	// Style's own round, which must not wake the settled review.
	report(t, "style", 1, `{"findings":[{"severity":"medium"}]}`)
	if !strings.Contains(hcLog(t, log), "Address the findings in .herdr-factory/style-1.json") {
		t.Fatal(hcLog(t, log))
	}
	report(t, "dev", 3, `{"summary":"styled"}`)
	run = loadRun()
	review, _ = run.stage("review")
	style, _ := run.stage("style")
	if review.Attempt != 2 || style.State != "working" || style.Attempt != 2 {
		t.Fatalf("%+v %+v", review, style)
	}
	report(t, "style", 2, `{"findings":[{"severity":"medium"}]}`)
	run = loadRun()
	if run.State != "done" {
		t.Fatalf("max rounds must end it: %+v", run)
	}
	text := []string{}
	for _, e := range run.Events {
		text = append(text, e.Text)
	}
	joined := strings.Join(text, "|")
	for _, want := range []string{"review round 1 of 2: findings back to dev", "style round 1 of 1: findings back to dev", "style stopped after round 1 with 1 open"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("no %q in %s", want, joined)
		}
	}
	if strings.Count(hcLog(t, log), "run --bg") != 3 { // one first launch per stage
		t.Fatalf("the live sessions must be reused: %s", hcLog(t, log))
	}
}

func TestAFollowupGivesALoopItsRoundsBack(t *testing.T) {
	setup(t, "t1 t9")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", loopConfig)
	must(t, "run", "w", "x")
	must(t, "next")
	report(t, "dev", 1, `{}`)
	report(t, "review", 1, `{"findings":[{"severity":"high"}]}`)
	report(t, "dev", 2, `{}`)
	must(t, "stage", "review", "stopped")
	must(t, "stop")
	must(t, "followup", "dev", "more")
	if r, _ := loadRun().stage("review"); r.Round != 0 || r.Settled {
		t.Fatalf("%+v", r)
	}
}

func TestLoopConfigIsChecked(t *testing.T) {
	for _, stages := range []string{
		`[{"id":"a","role":"r","loop":{"with":"b","max":1}},{"id":"b","role":"r"}]`,
		`[{"id":"a","role":"r"},{"id":"b","role":"r","loop":{"with":"a","max":0}}]`,
	} {
		var workflow Workflow
		if err := json.Unmarshal([]byte(`{"stages":`+stages+`}`), &workflow); err != nil {
			t.Fatal(err)
		}
		if validate("w", workflow, true) == nil {
			t.Fatalf("accepted %s", stages)
		}
	}
}

func TestRerunNeedsALiveOrchestrator(t *testing.T) {
	setup(t, "")
	must(t, "run", "implement", "x")
	err := dispatch([]string{"rerun", "dev"})
	if err == nil || !strings.Contains(err.Error(), "Factory") {
		t.Fatal(err)
	}
}

func TestContinueTakesOverAndRequeues(t *testing.T) {
	setup(t, "t2")
	must(t, "run", "implement", "x")
	if err := dispatch([]string{"next"}); err == nil {
		t.Fatal("next with a dead orchestrator must fail")
	}
	t.Setenv("HC_TERMINAL_ID", "t2")
	must(t, "stage", "dev", "failed")
	must(t, "continue")
	run := loadRun()
	if s, _ := run.stage("dev"); s.State != "queued" || run.Orchestrator != "t2" || run.State != "working" {
		t.Fatalf("%+v", run)
	}
}

func TestSidebarCommandsDoNotClaimTheRun(t *testing.T) {
	setup(t, "t1")
	must(t, "run", "implement", "x")
	t.Setenv("HC_TERMINAL_ID", "")
	must(t, "event", "note")
	if run := loadRun(); run.Orchestrator != "t1" {
		t.Fatal(run.Orchestrator)
	}
}

func TestARunningRunRefusesANewOne(t *testing.T) {
	setup(t, "t1")
	must(t, "run", "implement", "x")
	must(t, "next")
	if err := dispatch([]string{"run", "review", "y"}); err == nil {
		t.Fatal("must refuse")
	}
}

func TestANewRunClearsOldResults(t *testing.T) {
	setup(t, "t1")
	must(t, "run", "review", "x")
	writeResult(t, "review-1.json", `{"findings":[]}`)
	writeResult(t, "keep.json", `{}`)
	must(t, "run", "review", "y")
	if _, err := os.Stat(filepath.Join(stateDir, "review-1.json")); err == nil {
		t.Fatal("stale result kept")
	}
	if _, err := os.Stat(filepath.Join(stateDir, "keep.json")); err != nil {
		t.Fatal("unrelated file removed")
	}
}

func TestRepoConfigWinsButCannotChooseFlags(t *testing.T) {
	setup(t, "t1")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", `{"workflows":{"review":{"description":"mine","stages":[{"id":"r","role":"reviewer"}]}}}`)
	workflows, err := availableWorkflows()
	if err != nil || workflows["review"].Description != "mine" || workflows["implement"].Description == "" {
		t.Fatalf("%v %v", workflows, err)
	}
	writeResult(t, "workflow.json", `{"workflows":{"review":{"stages":[{"id":"r","role":"reviewer","args":["--dangerously-skip-permissions"]}]}}}`)
	if _, err := availableWorkflows(); err == nil || !strings.Contains(err.Error(), "args") {
		t.Fatal(err)
	}
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t"}, args...)...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

func TestAWorktreeReadsTheMainCheckoutsConfigUnlessItHasItsOwn(t *testing.T) {
	setup(t, "t1")
	main, _ := os.Getwd()
	worktree := filepath.Join(filepath.Dir(main), "worktree")
	gitIn(t, main, "init", "-q")
	gitIn(t, main, "commit", "-q", "--allow-empty", "-m", "first")
	gitIn(t, main, "worktree", "add", "-q", worktree)
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", `{"workflows":{"shared":{"description":"main","stages":[{"id":"a","role":"developer"}]}}}`)
	if err := os.Chdir(worktree); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(main) })
	workflows, err := availableWorkflows()
	if err != nil || workflows["shared"].Description != "main" {
		t.Fatalf("%v %v", workflows, err)
	}
	// The same trust as a repo file.
	if err := os.WriteFile(filepath.Join(main, stateDir, "workflow.json"), []byte(`{"workflows":{"shared":{"stages":[{"id":"a","role":"developer","args":["--dangerously-skip-permissions"]}]}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := availableWorkflows(); err == nil || !strings.Contains(err.Error(), "args") {
		t.Fatal(err)
	}
	// The worktree's own file wins, so the refused one above is not read.
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", `{"workflows":{"shared":{"description":"own","stages":[{"id":"a","role":"developer"}]}}}`)
	workflows, err = availableWorkflows()
	if err != nil || workflows["shared"].Description != "own" {
		t.Fatalf("%v %v", workflows, err)
	}
}

func TestOutsideGitThereIsNoMainCheckoutToRead(t *testing.T) {
	setup(t, "t1")
	if workflows, err := availableWorkflows(); err != nil || workflows["implement"].Description == "" {
		t.Fatalf("%v %v", workflows, err)
	}
}

func TestARepoStageInheritsOnlyTheHomeArgsOfTheSameWorkflowAndStage(t *testing.T) {
	log := setup(t, "t1")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeResult(t, "workflow.json", `{"workflows":{
 "implement":{"stages":[{"id":"dev","role":"developer"},{"id":"other","role":"reviewer"}]},
 "mine":{"stages":[{"id":"dev","role":"developer"}]}}}`)
	workflows, err := availableWorkflows()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(workflows["implement"].Stages[0].Args, " "); got != "--permission-mode acceptEdits" {
		t.Fatal(got)
	}
	if len(workflows["implement"].Stages[1].Args) != 0 || len(workflows["mine"].Stages[0].Args) != 0 {
		t.Fatalf("%+v", workflows)
	}
	must(t, "run", "implement", "x")
	must(t, "next")
	if !strings.Contains(hcLog(t, log), "--permission-mode acceptEdits") {
		t.Fatal(hcLog(t, log))
	}
}

func TestBadNamesAreRefused(t *testing.T) {
	for _, stages := range []string{
		`[{"id":"../x","role":"developer"}]`,
		`[{"id":"a","role":"../x"}]`,
		`[{"id":"a","role":"r"},{"id":"a","role":"r"}]`,
		`[{"id":"a","role":"r","agent":"sh"}]`,
		`[{"id":"a","role":"r","effort":"huge"}]`,
		`[]`,
	} {
		var workflow Workflow
		if err := json.Unmarshal([]byte(`{"stages":`+stages+`}`), &workflow); err != nil {
			t.Fatal(err)
		}
		if validate("w", workflow, true) == nil {
			t.Fatalf("accepted %s", stages)
		}
	}
}
