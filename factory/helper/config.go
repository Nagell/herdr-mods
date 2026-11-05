// Workflows and role templates: the person's, and a repo's within limits.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed all:defaults
var defaults embed.FS

var (
	namePattern = regexp.MustCompile(`^[a-z0-9_-]{1,24}$`)
	rolePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	resultFile  = regexp.MustCompile(`^[a-z0-9_-]+-\d+\.json$`)
	severities  = []string{"critical", "high", "medium", "low"}
	efforts     = map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
)

func configDir() string {
	if dir := os.Getenv("FACTORY_CONFIG_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "herdr-mods", "factory")
}

// Writes each default that is missing and leaves the person's files alone.
func initConfig() error {
	return fs.WalkDir(defaults, "defaults", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		target := filepath.Join(configDir(), strings.TrimPrefix(path, "defaults/"))
		if _, err := os.Stat(target); err == nil {
			return nil
		}
		data, err := defaults.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func readWorkflows(path string, trusted bool) (map[string]Workflow, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var file struct {
		Workflows map[string]Workflow `json:"workflows"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	for name, workflow := range file.Workflows {
		if err := validate(name, workflow, trusted); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
	}
	return file.Workflows, nil
}

// A cloned repo's config must not choose command-line flags, such as one that
// skips permission prompts, for sessions the person starts.
func validate(name string, workflow Workflow, trusted bool) error {
	if !namePattern.MatchString(name) {
		return fmt.Errorf("workflow name %q must be 1-24 of a-z 0-9 - _", name)
	}
	if len(workflow.Stages) == 0 {
		return fmt.Errorf("workflow %s has no stages", name)
	}
	seen := map[string]bool{}
	for _, s := range workflow.Stages {
		switch {
		case !namePattern.MatchString(s.ID):
			return fmt.Errorf("%s: stage id %q must be 1-24 of a-z 0-9 - _", name, s.ID)
		case seen[s.ID]:
			return fmt.Errorf("%s: stage id %q appears twice", name, s.ID)
		case !rolePattern.MatchString(s.Role):
			return fmt.Errorf("%s: stage %s: role must be a template name", name, s.ID)
		case s.Agent != "" && s.Agent != "claude" && s.Agent != "codex":
			return fmt.Errorf("%s: stage %s: agent must be claude or codex", name, s.ID)
		case s.Effort != "" && !efforts[s.Effort]:
			return fmt.Errorf("%s: stage %s: invalid effort %q", name, s.ID, s.Effort)
		case s.Loop != nil && !seen[s.Loop.With]:
			return fmt.Errorf("%s: stage %s: loop.with must name an earlier stage", name, s.ID)
		case s.Loop != nil && s.Loop.Max < 1:
			return fmt.Errorf("%s: stage %s: loop.max must be at least 1", name, s.ID)
		case !trusted && len(s.Args) > 0:
			return fmt.Errorf("%s: stage %s: args are only allowed in the config in your home folder", name, s.ID)
		}
		seen[s.ID] = true
	}
	return nil
}

// The repo's own workflows win over the global ones of the same name.
func availableWorkflows() (map[string]Workflow, error) {
	if err := initConfig(); err != nil {
		return nil, err
	}
	found, err := readWorkflows(filepath.Join(configDir(), "workflow.json"), true)
	if err != nil {
		return nil, err
	}
	local, err := readWorkflows(repoConfigPath(), false)
	if err != nil {
		return nil, err
	}
	if found == nil {
		found = map[string]Workflow{}
	}
	for name, workflow := range local {
		inheritArgs(workflow, found[name])
		found[name] = workflow
	}
	return found, nil
}

// This checkout's repo config, else the main checkout's: each git worktree has
// its own .herdr-factory/, which would otherwise never see the one kept in the repo.
func repoConfigPath() string {
	path := filepath.Join(stateDir, "workflow.json")
	if _, err := os.Stat(path); err == nil {
		return path
	}
	out, err := exec.Command("git", "rev-parse", "--git-common-dir").Output()
	if err != nil {
		return path
	}
	common, err := filepath.Abs(strings.TrimSpace(string(out)))
	if err != nil {
		return path
	}
	return filepath.Join(filepath.Dir(common), stateDir, "workflow.json")
}

// A repo stage can't choose flags, so it takes those the person set for the
// stage of the same id in their own workflow of the same name.
func inheritArgs(local, home Workflow) {
	for i := range local.Stages {
		for _, own := range home.Stages {
			if own.ID == local.Stages[i].ID {
				local.Stages[i].Args = own.Args
			}
		}
	}
}

func roleBody(role string) (string, error) {
	if !rolePattern.MatchString(role) {
		return "", fmt.Errorf("role %q must be a template name", role)
	}
	path := filepath.Join(configDir(), "templates", role+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("role %s: %w", role, err)
	}
	parts := strings.SplitN(string(data), "---", 3)
	if len(parts) != 3 || strings.TrimSpace(parts[0]) != "" {
		return "", fmt.Errorf("role %s: expected template frontmatter", role)
	}
	return strings.TrimSpace(parts[2]), nil
}
