package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func mock(t *testing.T, f func([]string, []byte) ([]byte, error)) {
	old := runner
	t.Cleanup(func() { runner = old })
	runner = func(_ context.Context, a []string, b []byte) ([]byte, error) { return f(a, b) }
}
func payload(t *testing.T, b []byte) Obj {
	t.Helper()
	var p Obj
	if e := json.Unmarshal(b, &p); e != nil {
		t.Fatal(e)
	}
	return p
}
func conn(nodes []any, next string) Obj {
	return Obj{"nodes": nodes, "pageInfo": Obj{"hasNextPage": next != "", "endCursor": next}}
}
func TestInvolvementUnionAndIndependentPagination(t *testing.T) {
	calls := 0
	mock(t, func(a []string, b []byte) ([]byte, error) {
		if reflect.DeepEqual(a, []string{"api", "user"}) {
			return mustJSON(Obj{"login": "me"}), nil
		}
		calls++
		v := object(payload(t, b)["variables"])
		q := text(v["q"])
		if !strings.Contains(q, "repo:owner/repo is:pr is:open") {
			t.Fatal(q)
		}
		next := ""
		if strings.Contains(q, "commenter:") {
			next = "comment-next"
		}
		return mustJSON(Obj{"data": Obj{"search": conn([]any{Obj{"id": "pr", "updatedAt": "2026-01-01"}}, next)}}), nil
	})
	got, e := list(context.Background(), Request{Repo: "owner/repo", Tab: "involved"})
	if e != nil {
		t.Fatal(e)
	}
	out := object(got)
	if len(array(out["items"])) != 1 || len(array(object(array(out["items"])[0])["reasons"])) != 4 || calls != 4 {
		t.Fatalf("%v, calls %d", out, calls)
	}
	calls = 0
	_, e = list(context.Background(), Request{Repo: "owner/repo", Tab: "involved", Cursors: map[string]string{"Commented": "comment-next"}})
	if e != nil {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatalf("expected only unfinished category, got %d calls", calls)
	}
}
func TestDetailPaginatesConversationAndThreadReplies(t *testing.T) {
	pages := 0
	mock(t, func(a []string, b []byte) ([]byte, error) {
		if a[0] == "pr" {
			return mustJSON(Obj{"statusCheckRollup": []any{}}), nil
		}
		v := object(payload(t, b)["variables"])
		if v["id"] == "thread" {
			return mustJSON(Obj{"data": Obj{"node": Obj{"comments": conn([]any{Obj{"id": "reply2"}}, "")}}}), nil
		}
		pages++
		pr := Obj{"id": "pr", "comments": conn([]any{Obj{"id": "comment1"}}, "page2"), "reviews": conn([]any{}, ""), "reviewThreads": conn([]any{Obj{"id": "thread", "comments": conn([]any{Obj{"id": "reply1"}}, "more-replies")}}, "")}
		if pages == 2 {
			if v["comments"] != "page2" {
				t.Fatal(v)
			}
			pr["comments"] = conn([]any{Obj{"id": "comment2"}}, "")
		}
		return mustJSON(Obj{"data": Obj{"repository": Obj{"pullRequest": pr}}}), nil
	})
	got, e := detail(context.Background(), Request{Repo: "owner/repo", Number: 1})
	if e != nil {
		t.Fatal(e)
	}
	pr := object(got)
	if len(array(pr["comments"])) != 2 || len(array(pr["threads"])) != 1 || len(array(object(array(pr["threads"])[0])["comments"])) != 2 {
		t.Fatal(pr)
	}
}
func TestCommentBodyIsJSONNotShell(t *testing.T) {
	body := "quotes ' \" and $(touch bad)\nline two"
	mock(t, func(a []string, b []byte) ([]byte, error) {
		if !reflect.DeepEqual(a, []string{"api", "repos/owner/repo/issues/2/comments", "--method", "POST", "--input", "-"}) {
			t.Fatal(a)
		}
		if payload(t, b)["body"] != body {
			t.Fatal(string(b))
		}
		return []byte(`{"id":1}`), nil
	})
	if _, e := handle(context.Background(), Request{Action: "comment", Repo: "owner/repo", Number: 2, Body: body}); e != nil {
		t.Fatal(e)
	}
}
func TestGraphQLErrorsFailEvenWithData(t *testing.T) {
	mock(t, func(a []string, b []byte) ([]byte, error) {
		return []byte(`{"data":{},"errors":[{"message":"no access"}]}`), nil
	})
	if _, e := gql(context.Background(), "query{}", nil); e == nil {
		t.Fatal("expected error")
	}
}
func TestMutations(t *testing.T) {
	for _, action := range []string{"reply", "resolve", "reopen"} {
		t.Run(action, func(t *testing.T) {
			mock(t, func(a []string, b []byte) ([]byte, error) {
				v := object(payload(t, b)["variables"])
				if v["id"] != "thread" {
					t.Fatal(v)
				}
				if action == "reply" && v["body"] != "response" {
					t.Fatal(v)
				}
				return []byte(`{"data":{}}`), nil
			})
			if _, e := handle(context.Background(), Request{Action: action, Repo: "owner/repo", Thread: "thread", Body: "response"}); e != nil {
				t.Fatal(e)
			}
		})
	}
	if _, e := handle(context.Background(), Request{Action: "list", Repo: "../bad"}); e == nil {
		t.Fatal("expected validation error")
	}
}

func TestBranchPRsMatchesExactBranchAndPaginates(t *testing.T) {
	pages := 0
	mock(t, func(args []string, b []byte) ([]byte, error) {
		vars := object(payload(t, b)["variables"])
		if vars["branch"] != "feature/x" {
			t.Fatal(vars)
		}
		pages++
		next := "next"
		if pages == 2 {
			next = ""
			if vars["cursor"] != "next" {
				t.Fatal(vars)
			}
		}
		return mustJSON(Obj{"data": Obj{"repository": Obj{"pullRequests": conn([]any{Obj{"id": pages, "headRefName": "feature/x"}, Obj{"id": "other", "headRefName": "feature/y"}}, next)}}}), nil
	})
	result, err := handle(context.Background(), Request{Action: "branch", Repo: "owner/repo", Branch: "feature/x"})
	if err != nil {
		t.Fatal(err)
	}
	items := array(object(result)["items"])
	if len(items) != 2 || object(items[0])["repository"] != "owner/repo" {
		t.Fatal(items)
	}
}

func TestDraftMergedAndClosedFilters(t *testing.T) {
	for state, qualifier := range map[string]string{"draft": "is:open draft:true", "merged": "is:merged", "closed": "is:closed is:unmerged"} {
		t.Run(state, func(t *testing.T) {
			mock(t, func(args []string, b []byte) ([]byte, error) {
				if len(b) == 0 {
					return mustJSON(Obj{"login": "me"}), nil
				}
				q := text(object(payload(t, b)["variables"])["q"])
				if !strings.Contains(q, qualifier) {
					t.Fatal(q)
				}
				return mustJSON(Obj{"data": Obj{"search": conn([]any{}, "")}}), nil
			})
			if _, err := list(context.Background(), Request{Repo: "owner/repo", State: state}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStatusReadsOnlyPRMetadataAndChecks(t *testing.T) {
	mock(t, func(args []string, _ []byte) ([]byte, error) {
		want := []string{"pr", "view", "42", "--repo", "owner/repo", "--json", "id,number,title,url,state,isDraft,headRefName,statusCheckRollup"}
		if !reflect.DeepEqual(args, want) {
			t.Fatalf("unexpected status command: %v", args)
		}
		return mustJSON(Obj{"number": 42, "state": "OPEN", "statusCheckRollup": []any{Obj{"conclusion": "FAILURE"}}}), nil
	})
	got, err := handle(context.Background(), Request{Action: "status", Repo: "owner/repo", Number: 42})
	if err != nil || object(got)["state"] != "OPEN" {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := handle(context.Background(), Request{Action: "status", Repo: "owner/repo", Number: 0}); err == nil {
		t.Fatal("accepted invalid PR number")
	}
}
