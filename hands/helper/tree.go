package main

// tree.go turns the bridge's flat element list into numbered lines, finds
// matches with their ancestors, and keeps the snapshot that actions read.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Element struct {
	Index       int     `json:"i"`
	Depth       int     `json:"d"`
	Role        string  `json:"role"`
	Subrole     string  `json:"subrole,omitempty"`
	Title       string  `json:"title,omitempty"`
	Desc        string  `json:"desc,omitempty"`
	Value       string  `json:"value,omitempty"`
	Placeholder string  `json:"placeholder,omitempty"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	W           float64 `json:"w"`
	H           float64 `json:"h"`
	Enabled     bool    `json:"enabled"`
	Focused     bool    `json:"focused,omitempty"`
}

type Snapshot struct {
	Pid      int       `json:"pid"`
	App      string    `json:"app"`
	Elements []Element `json:"elements"`
}

func elementsFrom(raw any) []Element {
	b, _ := json.Marshal(raw)
	var items []Element
	_ = json.Unmarshal(b, &items)
	for i := range items {
		items[i].Index = i
	}
	return items
}

func (e Element) line() string {
	parts := []string{fmt.Sprintf("%-4d%s%s", e.Index, strings.Repeat("  ", e.Depth), e.Role)}
	if e.Subrole != "" && e.Subrole != e.Role {
		parts[0] += "/" + strings.TrimPrefix(e.Subrole, "AX")
	}
	if e.Title != "" {
		parts = append(parts, fmt.Sprintf("%q", e.Title))
	}
	if e.Desc != "" && e.Desc != e.Title {
		parts = append(parts, "["+e.Desc+"]")
	}
	if e.Value != "" {
		parts = append(parts, "= "+fmt.Sprintf("%q", e.Value))
	}
	if e.Placeholder != "" {
		parts = append(parts, "placeholder "+fmt.Sprintf("%q", e.Placeholder))
	}
	if e.W > 0 || e.H > 0 {
		parts = append(parts, fmt.Sprintf("(%.0f,%.0f %.0f×%.0f)", e.X, e.Y, e.W, e.H))
	}
	if !e.Enabled {
		parts = append(parts, "disabled")
	}
	if e.Focused {
		parts = append(parts, "focused")
	}
	return strings.Join(parts, " ")
}

func (e Element) matches(query string) bool {
	q := strings.ToLower(query)
	for _, field := range []string{e.Role, e.Subrole, e.Title, e.Desc, e.Value, e.Placeholder} {
		if strings.Contains(strings.ToLower(field), q) {
			return true
		}
	}
	return false
}

// Matching elements plus every ancestor, in document order; matches are starred.
func findLines(items []Element, query string) []string {
	keep := map[int]bool{}
	marked := map[int]bool{}
	var stack []int // indices of the current ancestor chain, by depth
	for _, e := range items {
		stack = append(stack[:min(e.Depth, len(stack))], e.Index)
		if e.matches(query) {
			marked[e.Index] = true
			for _, i := range stack {
				keep[i] = true
			}
		}
	}
	lines := []string{}
	for _, e := range items {
		if !keep[e.Index] {
			continue
		}
		mark := "  "
		if marked[e.Index] {
			mark = "* "
		}
		lines = append(lines, mark+e.line())
	}
	return lines
}

func allLines(items []Element) []string {
	lines := make([]string, 0, len(items))
	for _, e := range items {
		lines = append(lines, "  "+e.line())
	}
	return lines
}

// Capped output says how much is hidden instead of trailing off silently.
func capLines(lines []string, max int) []string {
	if max <= 0 || len(lines) <= max {
		return lines
	}
	return append(lines[:max], fmt.Sprintf("… %d more lines (raise --max or narrow with --find)", len(lines)-max))
}

// ── State files ───────────────────────────────────────────────────────────

func stateDir() string {
	if dir := os.Getenv("HANDS_STATE_DIR"); dir != "" {
		return dir
	}
	if dir := loadSettings().StateDir; dir != "" {
		home, _ := os.UserHomeDir()
		return strings.Replace(dir, "~", home, 1)
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "hands")
}

func writeState(name string, v any) error {
	if err := os.MkdirAll(stateDir(), 0o755); err != nil {
		return err
	}
	b, _ := json.Marshal(v)
	// Whole files only: another agent may be reading this one right now.
	temp, err := os.CreateTemp(stateDir(), name+".*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(b); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), filepath.Join(stateDir(), name))
}

func readState(name string, v any) error {
	b, err := os.ReadFile(filepath.Join(stateDir(), name))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// Each terminal keeps its own snapshot, so agents running side by side never
// act on each other's listing. The shared file serves callers that have not
// listed anything themselves, such as a one-off `hc run`.
func ownSnapshotFile() string {
	id := os.Getenv("HC_TERMINAL_ID")
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(id) {
		return ""
	}
	return "snapshot-" + id + ".json"
}

func saveSnapshot(s Snapshot) error {
	if own := ownSnapshotFile(); own != "" {
		if err := writeState(own, s); err != nil {
			return err
		}
	}
	return writeState("snapshot.json", s)
}

func loadSnapshot() (Snapshot, error) {
	var s Snapshot
	if own := ownSnapshotFile(); own != "" && readState(own, &s) == nil {
		return s, nil
	}
	if err := readState("snapshot.json", &s); err != nil {
		return s, fmt.Errorf("no snapshot yet: run `hands see --app <name>` first, then act on an element number")
	}
	return s, nil
}

func (s Snapshot) element(index int) (Element, error) {
	if index < 0 || index >= len(s.Elements) {
		return Element{}, fmt.Errorf("element %d is not in the last snapshot (0–%d); run `hands see` again", index, len(s.Elements)-1)
	}
	e := s.Elements[index]
	if e.W <= 0 || e.H <= 0 {
		return e, fmt.Errorf("element %d (%s) has no position on screen, so it cannot be acted on; pick another or run `hands see` again", index, e.Role)
	}
	return e, nil
}
