// herdr-pr is a JSON bridge between the Herdr mod and gh's authenticated API.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Obj = map[string]any
type Request struct {
	Branch  string            `json:"branch"`
	Job     int               `json:"job"`
	Action  string            `json:"action"`
	Repo    string            `json:"repo"`
	Tab     string            `json:"tab"`
	State   string            `json:"state"`
	Search  string            `json:"search"`
	Cursors map[string]string `json:"cursors"`
	Number  int               `json:"number"`
	Run     int               `json:"run"`
	Thread  string            `json:"thread"`
	Body    string            `json:"body"`
}

var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var runner = runCommand

func runCommand(ctx context.Context, args []string, input []byte) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "gh", args...)
	cmd.Stdin = bytes.NewReader(input)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("GitHub: %s (%w)", strings.TrimSpace(stderr.String()), err)
	}
	return out.Bytes(), nil
}
func gh(ctx context.Context, args ...string) (any, error) {
	b, e := runner(ctx, args, nil)
	if e != nil {
		return nil, e
	}
	var v any
	e = json.Unmarshal(b, &v)
	return v, e
}
func gql(ctx context.Context, query string, vars Obj) (Obj, error) {
	payload := Obj{"query": query, "variables": vars}
	b, _ := json.Marshal(payload)
	raw, e := runner(ctx, []string{"api", "graphql", "--input", "-"}, b)
	if e != nil {
		return nil, e
	}
	var res struct {
		Data   Obj   `json:"data"`
		Errors []Obj `json:"errors"`
	}
	if e = json.Unmarshal(raw, &res); e != nil {
		return nil, e
	}
	if len(res.Errors) > 0 {
		return nil, fmt.Errorf("GitHub: %v", res.Errors)
	}
	return res.Data, nil
}
func object(v any) Obj { m, _ := v.(map[string]any); return m }
func array(v any) []any {
	a, _ := v.([]any)
	if a == nil {
		return []any{}
	}
	return a
}
func text(v any) string      { s, _ := v.(string); return s }
func connection(v any) []any { return array(object(v)["nodes"]) }
func cursor(v any) string {
	p := object(object(v)["pageInfo"])
	if p["hasNextPage"] == true {
		return text(p["endCursor"])
	}
	return ""
}
func nullCursor(s string) any {
	if s == "" {
		return nil
	}
	return s
}

const pageInfo = `pageInfo { hasNextPage endCursor }`
const cardFields = `id number title url state isDraft updatedAt headRefName author { login } labels(first:30) { nodes { name } }`

func list(ctx context.Context, r Request) (any, error) {
	viewer, e := gh(ctx, "api", "user")
	if e != nil {
		return nil, e
	}
	login := text(object(viewer)["login"])
	scope := "repo:" + r.Repo + " is:pr"
	switch r.State {
	case "draft":
		scope += " is:open draft:true"
	case "merged":
		scope += " is:merged"
	case "closed":
		scope += " is:closed is:unmerged"
	case "all":
	case "", "open":
		scope += " is:open"
	default:
		return nil, errors.New("invalid state")
	}
	scope += " sort:updated-desc"
	if strings.TrimSpace(r.Search) != "" {
		scope += " " + r.Search
	}
	filters := map[string]string{"all": ""}
	switch r.Tab {
	case "mine":
		filters = map[string]string{"Created": "author:" + login}
	case "involved":
		filters = map[string]string{"Assigned": "assignee:" + login, "Review requested": "review-requested:" + login, "Reviewed": "reviewed-by:" + login, "Commented": "commenter:" + login}
	case "", "all":
	default:
		return nil, errors.New("invalid tab")
	}
	rows := map[string]Obj{}
	next := map[string]string{}
	keys := []string{}
	for k := range filters {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	// Independent cursors avoid losing matches when one involvement category has more pages.
	for _, reason := range keys {
		if len(r.Cursors) > 0 && r.Cursors[reason] == "" {
			continue
		}
		data, e := gql(ctx, `query($q:String!,$cursor:String){search(type:ISSUE,query:$q,first:25,after:$cursor){`+pageInfo+` nodes {... on PullRequest {`+cardFields+`}}}}`, Obj{"q": scope + " " + filters[reason], "cursor": nullCursor(r.Cursors[reason])})
		if e != nil {
			return nil, e
		}
		conn := data["search"]
		if c := cursor(conn); c != "" {
			next[reason] = c
		}
		for _, node := range connection(conn) {
			pr := object(node)
			id := text(pr["id"])
			if id == "" {
				continue
			}
			if old := rows[id]; old != nil {
				pr = old
			} else {
				pr["reasons"] = []any{}
				rows[id] = pr
			}
			if reason != "all" {
				pr["reasons"] = append(array(pr["reasons"]), reason)
			}
		}
	}
	result := []any{}
	for _, pr := range rows {
		result = append(result, pr)
	}
	sort.Slice(result, func(i, j int) bool {
		return text(object(result[i])["updatedAt"]) > text(object(result[j])["updatedAt"])
	})
	return Obj{"items": result, "cursors": next, "viewer": login}, nil
}

const detailQuery = `query($owner:String!,$name:String!,$number:Int!,$comments:String,$reviews:String,$threads:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id number title url body state isDraft headRefName baseRefName headRefOid author{login} reviewDecision
 comments(first:100,after:$comments){` + pageInfo + ` nodes{id body url createdAt author{login}}}
 reviews(first:100,after:$reviews){` + pageInfo + ` nodes{id body url submittedAt state author{login}}}
 reviewThreads(first:50,after:$threads){` + pageInfo + ` nodes{id path line isResolved isOutdated viewerCanResolve viewerCanUnresolve viewerCanReply comments(first:100){` + pageInfo + ` nodes{id body url createdAt diffHunk author{login}}}}}
}}}`

func detail(ctx context.Context, r Request) (any, error) {
	parts := strings.Split(r.Repo, "/")
	vars := Obj{"owner": parts[0], "name": parts[1], "number": r.Number}
	var pr Obj
	comments, reviews, threads := []any{}, []any{}, []any{}
	for page := 0; page < 30; page++ {
		data, e := gql(ctx, detailQuery, vars)
		if e != nil {
			return nil, e
		}
		current := object(object(data["repository"])["pullRequest"])
		if current == nil {
			return nil, errors.New("PR not found or inaccessible")
		}
		if pr == nil {
			pr = current
		}
		for _, key := range []string{"comments", "reviews", "reviewThreads"} {
			param := key
			if key == "reviewThreads" {
				param = "threads"
			}
			if page > 0 && vars[param] == nil {
				continue
			}
			nodes := connection(current[key])
			switch key {
			case "comments":
				comments = append(comments, nodes...)
			case "reviews":
				reviews = append(reviews, nodes...)
			case "reviewThreads":
				threads = append(threads, nodes...)
			}
			vars[param] = nullCursor(cursor(current[key]))
		}
		if vars["comments"] == nil && vars["reviews"] == nil && vars["threads"] == nil {
			break
		}
		if page == 29 {
			return nil, errors.New("conversation exceeds pagination limit; open on GitHub")
		}
	}
	// Fetch additional replies in long threads rather than silently truncating them.
	for _, node := range threads {
		thread := object(node)
		conn := thread["comments"]
		replies := connection(conn)
		for c := cursor(conn); c != ""; c = cursor(conn) {
			data, e := gql(ctx, `query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){`+pageInfo+` nodes{id body url createdAt diffHunk author{login}}}}}}`, Obj{"id": thread["id"], "cursor": c})
			if e != nil {
				return nil, e
			}
			conn = object(data["node"])["comments"]
			replies = append(replies, connection(conn)...)
		}
		thread["comments"] = replies
	}
	pr["comments"] = comments
	pr["reviews"] = reviews
	pr["threads"] = threads
	delete(pr, "reviewThreads")
	checks, e := gh(ctx, "pr", "view", strconv.Itoa(r.Number), "--repo", r.Repo, "--json", "statusCheckRollup")
	if e != nil {
		pr["checksError"] = e.Error()
		pr["checks"] = []any{}
	} else {
		pr["checks"] = object(checks)["statusCheckRollup"]
	}
	return pr, nil
}
func branchPRs(ctx context.Context, r Request) (any, error) {
	if strings.TrimSpace(r.Branch) == "" {
		return nil, errors.New("branch is required")
	}
	parts := strings.Split(r.Repo, "/")
	vars := Obj{"owner": parts[0], "name": parts[1], "branch": r.Branch, "cursor": nil}
	items := []any{}
	for {
		data, err := gql(ctx, `query($owner:String!,$name:String!,$branch:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(headRefName:$branch,states:[OPEN,CLOSED,MERGED],first:100,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){`+pageInfo+` nodes{`+cardFields+` headRepository{nameWithOwner}}}}}`, vars)
		if err != nil {
			return nil, err
		}
		repository := object(data["repository"])
		if repository == nil {
			return nil, errors.New("repository unavailable")
		}
		conn := repository["pullRequests"]
		for _, node := range connection(conn) {
			pr := object(node)
			if pr["headRefName"] == r.Branch {
				pr["repository"] = r.Repo
				items = append(items, pr)
			}
		}
		next := cursor(conn)
		if next == "" {
			break
		}
		vars["cursor"] = next
	}
	return Obj{"items": items}, nil
}

func handle(ctx context.Context, r Request) (any, error) {
	parts := strings.Split(r.Repo, "/")
	if !repoPattern.MatchString(r.Repo) || len(parts) != 2 || parts[0] == "." || parts[0] == ".." || parts[1] == "." || parts[1] == ".." {
		return nil, errors.New("repository must be owner/name")
	}
	switch r.Action {
	case "branch":
		return branchPRs(ctx, r)
	case "list":
		return list(ctx, r)
	case "status":
		if r.Number < 1 {
			return nil, errors.New("invalid PR number")
		}
		return gh(ctx, "pr", "view", strconv.Itoa(r.Number), "--repo", r.Repo, "--json", "id,number,title,url,state,isDraft,headRefName,statusCheckRollup")
	case "detail":
		if r.Number < 1 {
			return nil, errors.New("invalid PR number")
		}
		return detail(ctx, r)
	case "logs":
		if r.Job < 1 {
			return nil, errors.New("invalid job")
		}
		b, err := runner(ctx, []string{"run", "view", "--repo", r.Repo, "--job", strconv.Itoa(r.Job), "--log-failed"}, nil)
		if err != nil {
			return nil, err
		}
		truncated := len(b) > 60000
		if truncated {
			b = b[len(b)-60000:]
		}
		return Obj{"text": string(b), "truncated": truncated}, nil
	case "jobs":
		if r.Run < 1 {
			return nil, errors.New("invalid run")
		}
		return gh(ctx, "api", "--paginate", "--slurp", fmt.Sprintf("repos/%s/actions/runs/%d/jobs?per_page=100", r.Repo, r.Run))
	case "comment":
		if r.Number < 1 || strings.TrimSpace(r.Body) == "" {
			return nil, errors.New("PR number and body required")
		}
		data, e := runner(ctx, []string{"api", fmt.Sprintf("repos/%s/issues/%d/comments", r.Repo, r.Number), "--method", "POST", "--input", "-"}, mustJSON(Obj{"body": r.Body}))
		if e != nil {
			return nil, e
		}
		var v any
		e = json.Unmarshal(data, &v)
		return v, e
	case "reply", "resolve", "reopen":
		if r.Thread == "" {
			return nil, errors.New("thread ID required")
		}
		vars := Obj{"id": r.Thread}
		query := ""
		if r.Action == "reply" {
			if strings.TrimSpace(r.Body) == "" {
				return nil, errors.New("reply required")
			}
			vars["body"] = r.Body
			query = `mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}`
		} else {
			mutation := "resolveReviewThread"
			if r.Action == "reopen" {
				mutation = "unresolveReviewThread"
			}
			query = `mutation($id:ID!){` + mutation + `(input:{threadId:$id}){thread{id isResolved}}}`
		}
		return gql(ctx, query, vars)
	default:
		return nil, errors.New("unknown action")
	}
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: herdr-pr '<JSON request>'")
		os.Exit(1)
	}
	var r Request
	if e := json.Unmarshal([]byte(os.Args[1]), &r); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 26*time.Second)
	defer cancel()
	result, e := handle(ctx, r)
	if e != nil {
		_ = json.NewEncoder(os.Stdout).Encode(Obj{"error": e.Error()})
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}
