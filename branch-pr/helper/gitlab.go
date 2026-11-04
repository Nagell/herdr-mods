// gitlab.go serves the same request contract as main.go for GitLab hosts,
// through glab's authenticated REST calls. Every response is reshaped into the
// GitHub-style objects the mod already renders: merge requests become PR
// cards, discussions become comments and threads, draft notes become the
// pending review, and pipeline jobs become checks.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var glabRunner = runGlab
var glabBinary = "glab"
var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]|section_(?:start|end):[0-9]+:[A-Za-z0-9_]+`)

func runGlab(ctx context.Context, args []string, input []byte) ([]byte, error) {
	cmd := exec.CommandContext(ctx, glabBinary, args...)
	cmd.Stdin = bytes.NewReader(input)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s|%w", strings.TrimSpace(stderr.String()), err)
	}
	return out.Bytes(), nil
}

// Everything here goes through the GitLab CLI, so say plainly when it is absent or logged out.
func describeGlabError(err error, host string) error {
	if errors.Is(err, exec.ErrNotFound) {
		return errors.New("GitLab CLI (glab) is not installed. Install it from https://gitlab.com/gitlab-org/cli, run `glab auth login`, then refresh.")
	}
	message := err.Error()
	if strings.Contains(message, "glab auth login") || strings.Contains(message, "not logged in") || strings.Contains(message, "401") {
		return fmt.Errorf("GitLab CLI is not logged in for %s. Run `glab auth login --hostname %s` in a terminal, then refresh.", host, host)
	}
	return fmt.Errorf("GitLab: %s", strings.TrimSuffix(message, "|exit status 1"))
}

type gitlab struct {
	ctx     context.Context
	host    string
	repo    string // host/group/project, as the mod names the repository
	project string // the URL-encoded project path for REST routes
	viewer  string
}

func (g *gitlab) raw(method, path string, body Obj) ([]byte, error) {
	args := []string{"api", "--hostname", g.host, "--method", method}
	var input []byte
	if body != nil {
		input = mustJSON(body)
		args = append(args, "--input", "-")
	}
	out, err := glabRunner(g.ctx, append(args, path), input)
	if err != nil {
		return nil, describeGlabError(err, g.host)
	}
	return out, nil
}

func (g *gitlab) call(method, path string, body Obj) (any, error) {
	out, err := g.raw(method, path, body)
	if err != nil || len(bytes.TrimSpace(out)) == 0 {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(out, &v); err != nil {
		return nil, fmt.Errorf("GitLab returned invalid JSON for %s", path)
	}
	return v, nil
}

// GitLab paginates with page numbers; 100 per page, 30 pages at most.
func (g *gitlab) pages(path string) ([]any, error) {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	items := []any{}
	for page := 1; page <= 30; page++ {
		data, err := g.call("GET", fmt.Sprintf("%s%sper_page=100&page=%d", path, sep, page), nil)
		if err != nil {
			return nil, err
		}
		batch := array(data)
		items = append(items, batch...)
		if len(batch) < 100 {
			return items, nil
		}
	}
	return nil, errors.New("conversation exceeds pagination limit; open on GitLab")
}

func (g *gitlab) mrPath(iid int, rest string) string {
	return fmt.Sprintf("projects/%s/merge_requests/%d%s", g.project, iid, rest)
}

func (g *gitlab) login() (string, error) {
	if g.viewer == "" {
		user, err := g.call("GET", "user", nil)
		if err != nil {
			return "", err
		}
		g.viewer = text(object(user)["username"])
	}
	return g.viewer, nil
}

func idText(v any) string {
	if n, ok := v.(float64); ok {
		return strconv.FormatInt(int64(n), 10)
	}
	return text(v)
}

func sortedKeys(m map[string][2]string) []string {
	keys := []string{}
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortByUpdated(items []any) {
	sort.SliceStable(items, func(i, j int) bool {
		return text(object(items[i])["updatedAt"]) > text(object(items[j])["updatedAt"])
	})
}

// ── Reshaping ────────────────────────────────────────────────────────────

func (g *gitlab) card(m Obj) Obj {
	state := strings.ToUpper(text(m["state"]))
	if state == "OPENED" || state == "LOCKED" {
		state = "OPEN"
	}
	labels := []any{}
	for _, l := range array(m["labels"]) {
		labels = append(labels, Obj{"name": l})
	}
	return Obj{
		"id": idText(m["id"]), "number": m["iid"], "title": m["title"], "url": m["web_url"], "state": state,
		"isDraft": m["draft"] == true, "updatedAt": m["updated_at"], "headRefName": m["source_branch"],
		"baseRefName": m["target_branch"], "headRefOid": m["sha"], "author": Obj{"login": text(object(m["author"])["username"])},
		"labels": Obj{"nodes": labels}, "repository": g.repo, "headRepository": Obj{"nameWithOwner": g.repo}, "reasons": []any{},
	}
}

func (g *gitlab) note(n Obj, webURL, viewer string) Obj {
	author := text(object(n["author"])["username"])
	return Obj{
		"id": idText(n["id"]), "body": n["body"], "url": fmt.Sprintf("%s#note_%s", webURL, idText(n["id"])),
		"createdAt": n["created_at"], "viewerCanUpdate": author != "" && author == viewer, "author": Obj{"login": author}, "diffHunk": "",
	}
}

func position(p Obj) (any, any) {
	path, line := p["new_path"], p["new_line"]
	if path == nil {
		path = p["old_path"]
	}
	if line == nil {
		line = p["old_line"]
	}
	return path, line
}

// Jobs map onto check runs; GitLab has no step level, so a job is one check.
func jobStatus(status string, allowFailure bool) (string, string) {
	switch status {
	case "success":
		return "COMPLETED", "SUCCESS"
	case "failed":
		if allowFailure {
			return "COMPLETED", "NEUTRAL"
		}
		return "COMPLETED", "FAILURE"
	case "canceled", "canceling":
		return "COMPLETED", "CANCELLED"
	case "skipped", "manual", "scheduled":
		return "COMPLETED", "SKIPPED"
	case "running":
		return "IN_PROGRESS", ""
	}
	return "QUEUED", ""
}

func (g *gitlab) checks(iid int) ([]any, error) {
	pipelines, err := g.call("GET", g.mrPath(iid, "/pipelines?per_page=1"), nil)
	if err != nil {
		return nil, err
	}
	latest := array(pipelines)
	if len(latest) == 0 {
		return []any{}, nil
	}
	pipeline := object(latest[0])
	jobs, err := g.pages(fmt.Sprintf("projects/%s/pipelines/%s/jobs", g.project, idText(pipeline["id"])))
	if err != nil {
		return nil, err
	}
	checks := []any{}
	for _, j := range jobs {
		job := object(j)
		status, conclusion := jobStatus(text(job["status"]), job["allow_failure"] == true)
		checks = append(checks, Obj{
			"name": job["name"], "status": status, "conclusion": conclusion, "detailsUrl": job["web_url"],
			"workflowName": fmt.Sprintf("Pipeline #%s", idText(pipeline["id"])), "runId": idText(pipeline["id"]),
			"startedAt": job["started_at"], "completedAt": job["finished_at"],
		})
	}
	return checks, nil
}

func (g *gitlab) detail(iid int) (Obj, error) {
	m, err := g.call("GET", g.mrPath(iid, ""), nil)
	if err != nil {
		return nil, err
	}
	mr := object(m)
	if mr == nil || mr["iid"] == nil {
		return nil, errors.New("merge request not found or inaccessible")
	}
	viewer, err := g.login()
	if err != nil {
		return nil, err
	}
	pr := g.card(mr)
	pr["body"] = mr["description"]
	webURL := text(mr["web_url"])
	discussions, err := g.pages(g.mrPath(iid, "/discussions"))
	if err != nil {
		return nil, err
	}
	comments, threads := []any{}, []any{}
	byID := map[string]Obj{}
	for _, d := range discussions {
		discussion := object(d)
		notes := []any{}
		for _, n := range array(discussion["notes"]) {
			if object(n)["system"] != true {
				notes = append(notes, g.note(object(n), webURL, viewer))
			}
		}
		if len(notes) == 0 {
			continue
		}
		first := object(array(discussion["notes"])[0])
		if discussion["individual_note"] == true {
			comments = append(comments, notes[0])
			continue
		}
		path, line := position(object(first["position"]))
		thread := Obj{
			"id": text(discussion["id"]), "path": path, "line": line, "isResolved": first["resolved"] == true, "isOutdated": false,
			"viewerCanResolve": first["resolvable"] == true, "viewerCanUnresolve": first["resolvable"] == true, "viewerCanReply": true, "comments": notes,
		}
		byID[text(discussion["id"])] = thread
		threads = append(threads, thread)
	}
	// Approvals are the closest thing to submitted reviews.
	reviews := []any{}
	if approvals, err := g.call("GET", g.mrPath(iid, "/approvals"), nil); err == nil {
		for _, a := range array(object(approvals)["approved_by"]) {
			user := object(object(a)["user"])
			reviews = append(reviews, Obj{
				"id": "approval:" + idText(user["id"]), "state": "APPROVED", "body": "Approved", "url": webURL, "submittedAt": nil,
				"viewerDidAuthor": text(user["username"]) == viewer, "viewerCanUpdate": false, "author": Obj{"login": user["username"]},
			})
		}
		if object(approvals)["approved"] == true {
			pr["reviewDecision"] = "APPROVED"
		}
	}
	// Draft notes are the viewer's unpublished review: replies join their
	// thread as pending comments and a general draft becomes the review body.
	drafts, err := g.pages(g.mrPath(iid, "/draft_notes"))
	if err != nil {
		return nil, err
	}
	pendingID, pendingBody := "draft", ""
	pending := Obj{"id": "draft", "state": "PENDING"}
	for _, d := range drafts {
		draft := object(d)
		comment := Obj{
			"id": "draft:" + idText(draft["id"]), "body": draft["note"], "url": webURL, "createdAt": nil, "viewerCanUpdate": true,
			"pullRequestReview": pending, "author": Obj{"login": viewer}, "diffHunk": "",
		}
		if thread := byID[text(draft["discussion_id"])]; thread != nil {
			thread["comments"] = append(array(thread["comments"]), comment)
		} else if pos := object(draft["position"]); pos != nil {
			path, line := position(pos)
			threads = append(threads, Obj{
				"id": "draft:" + idText(draft["id"]), "path": path, "line": line, "isResolved": false, "isOutdated": false,
				"viewerCanResolve": false, "viewerCanUnresolve": false, "viewerCanReply": false, "comments": []any{comment},
			})
		} else {
			pendingID, pendingBody = "draft-note:"+idText(draft["id"]), text(draft["note"])
		}
	}
	if len(drafts) > 0 {
		pending["id"] = pendingID
		reviews = append(reviews, Obj{
			"id": pendingID, "state": "PENDING", "body": pendingBody, "url": webURL, "submittedAt": nil,
			"viewerDidAuthor": true, "viewerCanUpdate": true, "author": Obj{"login": viewer},
		})
	}
	pr["comments"], pr["reviews"], pr["threads"] = comments, reviews, threads
	if checks, err := g.checks(iid); err != nil {
		pr["checksError"] = err.Error()
		pr["checks"] = []any{}
	} else {
		pr["checks"] = checks
	}
	return pr, nil
}

func (g *gitlab) list(r Request) (any, error) {
	viewer, err := g.login()
	if err != nil {
		return nil, err
	}
	params := url.Values{"scope": {"all"}, "order_by": {"updated_at"}, "sort": {"desc"}, "per_page": {strconv.Itoa(pageSize(r))}}
	switch r.State {
	case "draft":
		params.Set("state", "opened")
		params.Set("wip", "yes")
	case "merged", "closed", "all":
		params.Set("state", r.State)
	case "", "open":
		params.Set("state", "opened")
	default:
		return nil, errors.New("invalid state")
	}
	if s := strings.TrimSpace(r.Search); s != "" {
		params.Set("search", s)
	}
	filters := map[string][2]string{"all": {}}
	switch r.Tab {
	case "mine":
		filters = map[string][2]string{"Created": {"author_username", viewer}}
	case "involved":
		filters = map[string][2]string{"Assigned": {"assignee_username", viewer}, "Review requested": {"reviewer_username", viewer}, "Approved": {"approved_by_usernames[]", viewer}}
	case "", "all":
	default:
		return nil, errors.New("invalid tab")
	}
	rows := map[string]Obj{}
	order := []string{}
	next := map[string]string{}
	for _, reason := range sortedKeys(filters) {
		page := 1
		if len(r.Cursors) > 0 {
			if r.Cursors[reason] == "" {
				continue
			}
			page, _ = strconv.Atoi(r.Cursors[reason])
		}
		query := url.Values{}
		for k, v := range params {
			query[k] = v
		}
		if f := filters[reason]; f[0] != "" {
			query.Set(f[0], f[1])
		}
		query.Set("page", strconv.Itoa(page))
		data, err := g.call("GET", fmt.Sprintf("projects/%s/merge_requests?%s", g.project, query.Encode()), nil)
		if err != nil {
			return nil, err
		}
		batch := array(data)
		if len(batch) == pageSize(r) {
			next[reason] = strconv.Itoa(page + 1)
		}
		for _, item := range batch {
			pr := g.card(object(item))
			id := text(pr["id"])
			if old := rows[id]; old != nil {
				pr = old
			} else {
				rows[id] = pr
				order = append(order, id)
			}
			if reason != "all" {
				pr["reasons"] = append(array(pr["reasons"]), reason)
			}
		}
	}
	result := []any{}
	for _, id := range order {
		result = append(result, rows[id])
	}
	sortByUpdated(result)
	return Obj{"items": result, "cursors": next, "viewer": viewer}, nil
}

func (g *gitlab) branch(name string) (any, error) {
	items := []any{}
	mrs, err := g.pages(fmt.Sprintf("projects/%s/merge_requests?scope=all&state=all&order_by=updated_at&sort=desc&source_branch=%s", g.project, url.QueryEscape(name)))
	if err != nil {
		return nil, err
	}
	for _, m := range mrs {
		items = append(items, g.card(object(m)))
	}
	return Obj{"items": items}, nil
}

// ── Dispatch ─────────────────────────────────────────────────────────────

func gitlabHandle(ctx context.Context, r Request, host, path string) (any, error) {
	g := &gitlab{ctx: ctx, host: host, repo: host + "/" + path, project: url.PathEscape(path)}
	needNumber := func() error {
		if r.Number < 1 {
			return errors.New("invalid merge request number")
		}
		return nil
	}
	switch r.Action {
	case "branch":
		if strings.TrimSpace(r.Branch) == "" {
			return nil, errors.New("branch is required")
		}
		return g.branch(r.Branch)
	case "list":
		return g.list(r)
	case "status":
		if err := needNumber(); err != nil {
			return nil, err
		}
		m, err := g.call("GET", g.mrPath(r.Number, ""), nil)
		if err != nil {
			return nil, err
		}
		pr := g.card(object(m))
		if checks, err := g.checks(r.Number); err == nil {
			pr["statusCheckRollup"] = checks
		} else {
			pr["statusCheckRollup"] = []any{}
		}
		return pr, nil
	case "detail":
		if err := needNumber(); err != nil {
			return nil, err
		}
		return g.detail(r.Number)
	case "jobs":
		if r.Run < 1 {
			return nil, errors.New("invalid pipeline")
		}
		jobs, err := g.pages(fmt.Sprintf("projects/%s/pipelines/%d/jobs", g.project, r.Run))
		if err != nil {
			return nil, err
		}
		mapped := []any{}
		for _, j := range jobs {
			job := object(j)
			conclusion := text(job["status"])
			if conclusion == "failed" {
				conclusion = "failure"
			}
			mapped = append(mapped, Obj{"id": job["id"], "name": job["name"], "conclusion": conclusion, "started_at": job["started_at"], "completed_at": job["finished_at"], "steps": []any{}})
		}
		return []any{Obj{"jobs": mapped}}, nil
	case "logs":
		if r.Job < 1 {
			return nil, errors.New("invalid job")
		}
		b, err := g.raw("GET", fmt.Sprintf("projects/%s/jobs/%d/trace", g.project, r.Job), nil)
		if err != nil {
			return nil, err
		}
		// Traces carry terminal colours and section markers; the panel shows plain text.
		b = ansiPattern.ReplaceAll(bytes.ReplaceAll(b, []byte("\r"), nil), nil)
		limit := tailBytes(r)
		truncated := len(b) > limit
		if truncated {
			b = b[len(b)-limit:]
		}
		return Obj{"text": string(b), "truncated": truncated}, nil
	case "comment":
		if r.Number < 1 || strings.TrimSpace(r.Body) == "" {
			return nil, errors.New("merge request number and body required")
		}
		return g.call("POST", g.mrPath(r.Number, "/notes"), Obj{"body": r.Body})
	case "reply":
		if err := needNumber(); err != nil {
			return nil, err
		}
		if r.Thread == "" || strings.TrimSpace(r.Body) == "" {
			return nil, errors.New("thread ID and reply required")
		}
		// With a review the reply becomes a draft note, published with the review.
		if r.Review != "" {
			return g.call("POST", g.mrPath(r.Number, "/draft_notes"), Obj{"note": r.Body, "in_reply_to_discussion_id": r.Thread})
		}
		return g.call("POST", g.mrPath(r.Number, "/discussions/"+r.Thread+"/notes"), Obj{"body": r.Body})
	case "resolve", "reopen":
		if err := needNumber(); err != nil {
			return nil, err
		}
		if r.Thread == "" {
			return nil, errors.New("thread ID required")
		}
		return g.call("PUT", g.mrPath(r.Number, "/discussions/"+r.Thread), Obj{"resolved": r.Action == "resolve"})
	case "start-review":
		if err := needNumber(); err != nil {
			return nil, err
		}
		id := "draft"
		if strings.TrimSpace(r.Body) != "" {
			created, err := g.call("POST", g.mrPath(r.Number, "/draft_notes"), Obj{"note": r.Body})
			if err != nil {
				return nil, err
			}
			id = "draft-note:" + idText(object(created)["id"])
		}
		return Obj{"addPullRequestReview": Obj{"pullRequestReview": Obj{"id": id, "state": "PENDING"}}}, nil
	case "update-review":
		if err := needNumber(); err != nil {
			return nil, err
		}
		if strings.TrimSpace(r.Body) == "" {
			return nil, errors.New("review body required")
		}
		if id, ok := strings.CutPrefix(r.Review, "draft-note:"); ok {
			return g.call("PUT", g.mrPath(r.Number, "/draft_notes/"+id), Obj{"note": r.Body})
		}
		return g.call("POST", g.mrPath(r.Number, "/draft_notes"), Obj{"note": r.Body})
	case "submit-review":
		if err := needNumber(); err != nil {
			return nil, err
		}
		switch r.Event {
		case "", "COMMENT", "APPROVE":
		case "REQUEST_CHANGES":
			return nil, errors.New("GitLab has no request-changes review; publish as a comment or approve")
		default:
			return nil, errors.New("invalid review event")
		}
		if _, err := g.raw("POST", g.mrPath(r.Number, "/draft_notes/bulk_publish"), Obj{}); err != nil {
			return nil, err
		}
		if r.Event == "APPROVE" {
			return g.call("POST", g.mrPath(r.Number, "/approve"), Obj{})
		}
		return Obj{"published": true}, nil
	case "edit-comment", "edit-reply":
		if err := needNumber(); err != nil {
			return nil, err
		}
		if r.Comment == "" || strings.TrimSpace(r.Body) == "" {
			return nil, errors.New("comment ID and body required")
		}
		if id, ok := strings.CutPrefix(r.Comment, "draft:"); ok {
			return g.call("PUT", g.mrPath(r.Number, "/draft_notes/"+id), Obj{"note": r.Body})
		}
		return g.call("PUT", g.mrPath(r.Number, "/notes/"+r.Comment), Obj{"body": r.Body})
	default:
		return nil, errors.New("unknown action")
	}
}
