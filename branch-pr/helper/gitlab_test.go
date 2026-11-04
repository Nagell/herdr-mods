package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type glabCall struct {
	args []string
	body Obj
}

func mockGlab(t *testing.T, routes map[string]any) *[]glabCall {
	calls := &[]glabCall{}
	old := glabRunner
	t.Cleanup(func() { glabRunner = old })
	glabRunner = func(_ context.Context, args []string, input []byte) ([]byte, error) {
		var body Obj
		if len(input) > 0 {
			_ = json.Unmarshal(input, &body)
		}
		*calls = append(*calls, glabCall{args, body})
		path := args[len(args)-1]
		best := ""
		for prefix := range routes {
			if strings.HasPrefix(path, prefix) && len(prefix) > len(best) {
				best = prefix
			}
		}
		if best == "" {
			return []byte(`[]`), nil
		}
		return mustJSON(routes[best]), nil
	}
	return calls
}

func (c glabCall) method() string {
	for i, a := range c.args {
		if a == "--method" {
			return c.args[i+1]
		}
	}
	return ""
}

func (c glabCall) path() string { return c.args[len(c.args)-1] }

const repo = "gitlab.com/group/sub/project"

func TestSplitRepoAcceptsNestedGitLabPathsOnly(t *testing.T) {
	for _, bad := range []string{"owner", "owner/name/extra", "gitlab.com/only", "gitlab.com/../x", "a b/c"} {
		if _, _, err := splitRepo(bad); err == nil {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
	host, path, err := splitRepo(repo)
	if err != nil || host != "gitlab.com" || path != "group/sub/project" {
		t.Fatalf("got %q %q %v", host, path, err)
	}
	if host, path, _ := splitRepo("owner/name"); host != "" || path != "owner/name" {
		t.Fatalf("github repo parsed as %q %q", host, path)
	}
}

func TestGitLabDetailReshapesDiscussionsDraftsApprovalsAndJobs(t *testing.T) {
	mr := Obj{"id": 42.0, "iid": 7.0, "title": "Fix", "web_url": "https://gitlab.com/group/sub/project/-/merge_requests/7", "state": "opened", "draft": true,
		"updated_at": "2026-01-02", "source_branch": "fix", "target_branch": "main", "sha": "abc", "author": Obj{"username": "alice"}, "labels": []any{"bug"}, "description": "Body"}
	note := func(id float64, user, body string, system bool) Obj {
		return Obj{"id": id, "body": body, "author": Obj{"username": user}, "created_at": "2026-01-01", "system": system, "resolvable": !system, "resolved": false}
	}
	diffNote := note(2, "bob", "Concern", false)
	diffNote["position"] = Obj{"new_path": "file.go", "new_line": 3.0}
	calls := mockGlab(t, map[string]any{
		"user": Obj{"username": "me"},
		"projects/group%2Fsub%2Fproject/merge_requests/7/discussions": []any{
			Obj{"id": "d1", "individual_note": true, "notes": []any{note(1, "me", "General", false)}},
			Obj{"id": "sys", "individual_note": true, "notes": []any{note(9, "me", "changed title", true)}},
			Obj{"id": "d2", "individual_note": false, "notes": []any{diffNote, note(3, "alice", "Reply", false)}},
		},
		"projects/group%2Fsub%2Fproject/merge_requests/7/approvals":   Obj{"approved": true, "approved_by": []any{Obj{"user": Obj{"id": 5.0, "username": "carol"}}}},
		"projects/group%2Fsub%2Fproject/merge_requests/7/draft_notes": []any{Obj{"id": 11.0, "note": "pending reply", "discussion_id": "d2"}, Obj{"id": 12.0, "note": "summary"}},
		"projects/group%2Fsub%2Fproject/merge_requests/7/pipelines":   []any{Obj{"id": 55.0}},
		"projects/group%2Fsub%2Fproject/merge_requests/7":             mr,
		"projects/group%2Fsub%2Fproject/pipelines/55/jobs": []any{
			Obj{"id": 100.0, "name": "test", "status": "failed", "web_url": "https://gitlab.com/group/sub/project/-/jobs/100", "started_at": "a", "finished_at": "b"},
			Obj{"id": 101.0, "name": "lint", "status": "failed", "allow_failure": true},
			Obj{"id": 102.0, "name": "deploy", "status": "running"},
		},
	})
	out, err := handle(context.Background(), Request{Action: "detail", Repo: repo, Number: 7})
	if err != nil {
		t.Fatal(err)
	}
	pr := out.(Obj)
	if pr["id"] != "42" || pr["number"] != 7.0 || pr["state"] != "OPEN" || pr["isDraft"] != true || pr["body"] != "Body" || pr["headRefOid"] != "abc" || pr["reviewDecision"] != "APPROVED" {
		t.Fatalf("card %v", pr)
	}
	comments := pr["comments"].([]any)
	if len(comments) != 1 || object(comments[0])["viewerCanUpdate"] != true || object(comments[0])["url"] != mr["web_url"].(string)+"#note_1" {
		t.Fatalf("comments %v", comments)
	}
	threads := pr["threads"].([]any)
	if len(threads) != 1 {
		t.Fatalf("threads %v", threads)
	}
	thread := object(threads[0])
	replies := thread["comments"].([]any)
	if thread["id"] != "d2" || thread["path"] != "file.go" || thread["line"] != 3.0 || thread["viewerCanResolve"] != true || len(replies) != 3 {
		t.Fatalf("thread %v", thread)
	}
	if draft := object(replies[2]); draft["id"] != "draft:11" || object(draft["pullRequestReview"])["state"] != "PENDING" || object(draft["pullRequestReview"])["id"] != "draft-note:12" {
		t.Fatalf("draft reply %v", draft)
	}
	reviews := pr["reviews"].([]any)
	if len(reviews) != 2 || object(reviews[0])["state"] != "APPROVED" || object(reviews[1])["id"] != "draft-note:12" || object(reviews[1])["body"] != "summary" || object(reviews[1])["viewerDidAuthor"] != true {
		t.Fatalf("reviews %v", reviews)
	}
	checks := pr["checks"].([]any)
	if len(checks) != 3 || object(checks[0])["conclusion"] != "FAILURE" || object(checks[1])["conclusion"] != "NEUTRAL" || object(checks[2])["status"] != "IN_PROGRESS" || object(checks[0])["runId"] != "55" {
		t.Fatalf("checks %v", checks)
	}
	for _, c := range *calls {
		if !strings.Contains(strings.Join(c.args, " "), "--hostname gitlab.com") {
			t.Fatalf("call without hostname: %v", c.args)
		}
	}
}

func TestSettingsFieldsReachTheRequests(t *testing.T) {
	calls := mockGlab(t, map[string]any{"user": Obj{"username": "me"}})
	if _, err := handle(context.Background(), Request{Action: "list", Repo: repo, PageSize: 10, Tools: map[string]string{"gitlab": "/opt/glab"}}); err != nil {
		t.Fatal(err)
	}
	if glabBinary != "/opt/glab" {
		t.Fatalf("tool path not applied: %s", glabBinary)
	}
	glabBinary = "glab"
	last := (*calls)[len(*calls)-1].path()
	if !strings.Contains(last, "per_page=10") {
		t.Fatalf("page size missing in %s", last)
	}
	glabRunner = func(_ context.Context, _ []string, _ []byte) ([]byte, error) { return []byte("0123456789"), nil }
	out, err := handle(context.Background(), Request{Action: "logs", Repo: repo, Job: 1, Tail: 4})
	if err != nil || out.(Obj)["text"] != "6789" || out.(Obj)["truncated"] != true {
		t.Fatalf("tail %v %v", out, err)
	}
	if pageSize(Request{PageSize: 500}) != 25 || tailBytes(Request{}) != 60000 {
		t.Fatal("defaults")
	}
}

func TestGitLabListFiltersAndPagesByNumber(t *testing.T) {
	calls := mockGlab(t, map[string]any{"user": Obj{"username": "me"}})
	if _, err := handle(context.Background(), Request{Action: "list", Repo: repo, Tab: "involved", State: "draft", Search: "login", Cursors: map[string]string{"Assigned": "3"}}); err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, c := range *calls {
		if strings.Contains(c.path(), "merge_requests?") {
			paths = append(paths, c.path())
		}
	}
	if len(paths) != 1 {
		t.Fatalf("expected only the Assigned page, got %v", paths)
	}
	for _, want := range []string{"scope=all", "state=opened", "wip=yes", "search=login", "assignee_username=me", "page=3", "per_page=25"} {
		if !strings.Contains(paths[0], want) {
			t.Fatalf("missing %s in %s", want, paths[0])
		}
	}
}

func TestGitLabMutationsRouteToNotesDraftsAndApprovals(t *testing.T) {
	calls := mockGlab(t, map[string]any{"projects/group%2Fsub%2Fproject/merge_requests/7/draft_notes": Obj{"id": 31.0}})
	run := func(r Request) glabCall {
		t.Helper()
		r.Repo, r.Number = repo, 7
		before := len(*calls)
		if _, err := handle(context.Background(), r); err != nil {
			t.Fatal(err)
		}
		return (*calls)[before]
	}
	if c := run(Request{Action: "comment", Body: "hi"}); c.method() != "POST" || !strings.HasSuffix(c.path(), "/merge_requests/7/notes") || c.body["body"] != "hi" {
		t.Fatalf("comment %v", c)
	}
	if c := run(Request{Action: "reply", Thread: "d2", Body: "now"}); !strings.HasSuffix(c.path(), "/discussions/d2/notes") {
		t.Fatalf("reply %v", c)
	}
	if c := run(Request{Action: "reply", Thread: "d2", Body: "later", Review: "draft"}); !strings.HasSuffix(c.path(), "/draft_notes") || c.body["in_reply_to_discussion_id"] != "d2" || c.body["note"] != "later" {
		t.Fatalf("draft reply %v", c)
	}
	if c := run(Request{Action: "resolve", Thread: "d2"}); c.method() != "PUT" || c.body["resolved"] != true {
		t.Fatalf("resolve %v", c)
	}
	if c := run(Request{Action: "reopen", Thread: "d2"}); c.body["resolved"] != false {
		t.Fatalf("reopen %v", c)
	}
	out, err := handle(context.Background(), Request{Action: "start-review", Repo: repo, Number: 7, Body: "summary"})
	if err != nil || object(object(out.(Obj)["addPullRequestReview"])["pullRequestReview"])["id"] != "draft-note:31" {
		t.Fatalf("start-review %v %v", out, err)
	}
	if c := run(Request{Action: "update-review", Review: "draft-note:31", Body: "more"}); c.method() != "PUT" || !strings.HasSuffix(c.path(), "/draft_notes/31") || c.body["note"] != "more" {
		t.Fatalf("update-review %v", c)
	}
	if c := run(Request{Action: "edit-reply", Comment: "draft:11", Body: "edited"}); !strings.HasSuffix(c.path(), "/draft_notes/11") {
		t.Fatalf("edit draft %v", c)
	}
	if c := run(Request{Action: "edit-comment", Comment: "1", Body: "edited"}); c.method() != "PUT" || !strings.HasSuffix(c.path(), "/notes/1") || c.body["body"] != "edited" {
		t.Fatalf("edit note %v", c)
	}
	before := len(*calls)
	if _, err := handle(context.Background(), Request{Action: "submit-review", Repo: repo, Number: 7, Review: "draft", Event: "APPROVE"}); err != nil {
		t.Fatal(err)
	}
	if got := (*calls)[before:]; len(got) != 2 || !strings.HasSuffix(got[0].path(), "/draft_notes/bulk_publish") || !strings.HasSuffix(got[1].path(), "/approve") {
		t.Fatalf("submit %v", got)
	}
	if _, err := handle(context.Background(), Request{Action: "submit-review", Repo: repo, Number: 7, Review: "draft", Event: "REQUEST_CHANGES"}); err == nil {
		t.Fatal("expected request-changes to be refused")
	}
	if _, err := handle(context.Background(), Request{Action: "logs", Repo: repo, Job: 0}); err == nil {
		t.Fatal("expected invalid job")
	}
	glabRunner = func(_ context.Context, _ []string, _ []byte) ([]byte, error) {
		return []byte("\x1b[0Ksection_start:1:step\r\x1b[0K\x1b[32mok\x1b[0;m done\n"), nil
	}
	out, err = handle(context.Background(), Request{Action: "logs", Repo: repo, Job: 5})
	if err != nil || out.(Obj)["text"] != "ok done\n" {
		t.Fatalf("logs %v %v", out, err)
	}
}

func TestGitLabStateChanges(t *testing.T) {
	calls := mockGlab(t, map[string]any{"projects/group%2Fsub%2Fproject/merge_requests/7": Obj{"iid": 7.0}, "projects/group%2Fsub%2Fproject/merge_requests/7/merge": Obj{"iid": 7.0}})
	run := func(event string) (glabCall, error) {
		before := len(*calls)
		_, err := handle(context.Background(), Request{Action: "change-state", Repo: repo, Number: 7, Event: event, Head: "abc"})
		if err != nil {
			return glabCall{}, err
		}
		return (*calls)[before], nil
	}
	if c, err := run("squash"); err != nil || c.method() != "PUT" || !strings.HasSuffix(c.path(), "/merge_requests/7/merge") || c.body["squash"] != true || c.body["sha"] != "abc" {
		t.Fatalf("squash %v %v", c, err)
	}
	before := len(*calls)
	if _, err := handle(context.Background(), Request{Action: "change-state", Repo: repo, Number: 7, Event: "squash", Head: "abc", Body: "Fix\n\nWhy"}); err != nil || (*calls)[before].body["squash_commit_message"] != "Fix\n\nWhy" {
		t.Fatalf("squash message %v %v", *calls, err)
	}
	if c, err := run("merge"); err != nil || c.body["squash"] != false {
		t.Fatalf("merge %v %v", c, err)
	}
	if c, err := run("close"); err != nil || !strings.HasSuffix(c.path(), "/merge_requests/7") || c.body["state_event"] != "close" {
		t.Fatalf("close %v %v", c, err)
	}
	if c, err := run("reopen"); err != nil || c.body["state_event"] != "reopen" {
		t.Fatalf("reopen %v %v", c, err)
	}
	if _, err := run("rebase"); err == nil {
		t.Fatal("GitLab rebase was not refused")
	}
}
