package main

// settings.go reads the `settings` block of the mod.json installed beside the
// binary (mods/hands/mod.json, with the binary in mods/hands/bin), so the CLI
// shares its defaults with the pane. Missing or malformed values keep the
// built-in defaults; HANDS_STATE_DIR still wins over state_dir.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// A duration in the manifest may be "450ms" or a bare number of milliseconds.
type durationText string

func (d *durationText) UnmarshalJSON(b []byte) error {
	*d = durationText(strings.Trim(string(b), `"`))
	return nil
}

type Settings struct {
	Pause struct {
		AfterAction durationText `json:"after_action"`
		BetweenKeys durationText `json:"between_keys"`
	} `json:"pause"`
	See struct {
		MaxLines int `json:"max_lines"`
		MaxDepth int `json:"max_depth"`
	} `json:"see"`
	Record struct {
		FramesPerSecond int `json:"frames_per_second"`
	} `json:"record"`
	Pane struct {
		Refresh durationText `json:"refresh"`
	} `json:"pane"`
	StateDir string `json:"state_dir"`
}

var durationPattern = regexp.MustCompile(`^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s*$`)

// parseDuration reads "450ms", "60s", "5m" or a bare number of milliseconds.
func parseDuration(text string, fallback time.Duration) time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(text)); err == nil && n >= 0 {
		return time.Duration(n) * time.Millisecond
	}
	m := durationPattern.FindStringSubmatch(text)
	if m == nil {
		return fallback
	}
	value, _ := strconv.ParseFloat(m[1], 64)
	unit := map[string]time.Duration{"ms": time.Millisecond, "s": time.Second, "m": time.Minute, "h": time.Hour}[m[2]]
	return time.Duration(value * float64(unit))
}

func manifestPath() string {
	if p := os.Getenv("HANDS_MANIFEST"); p != "" {
		return p
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return manifestBeside(exe)
}

// The binary is usually reached through ~/.local/bin/hands, so follow the link.
func manifestBeside(exe string) string {
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return filepath.Join(filepath.Dir(exe), "..", "mod.json")
}

// loadSettings never fails: whatever cannot be read stays at its default.
func loadSettings() Settings {
	var s Settings
	s.See.MaxLines, s.See.MaxDepth, s.Record.FramesPerSecond = 300, 60, 30
	var manifest struct {
		Settings Settings `json:"settings"`
	}
	if b, err := os.ReadFile(manifestPath()); err == nil && json.Unmarshal(b, &manifest) == nil {
		given := manifest.Settings
		if given.Pause.AfterAction != "" {
			s.Pause.AfterAction = given.Pause.AfterAction
		}
		if given.Pause.BetweenKeys != "" {
			s.Pause.BetweenKeys = given.Pause.BetweenKeys
		}
		if given.See.MaxLines > 0 {
			s.See.MaxLines = given.See.MaxLines
		}
		if given.See.MaxDepth > 0 {
			s.See.MaxDepth = given.See.MaxDepth
		}
		if given.Record.FramesPerSecond > 0 && given.Record.FramesPerSecond <= 120 {
			s.Record.FramesPerSecond = given.Record.FramesPerSecond
		}
		if given.StateDir != "" {
			s.StateDir = given.StateDir
		}
	}
	return s
}

func (s Settings) afterAction() time.Duration {
	return parseDuration(string(s.Pause.AfterAction), 500*time.Millisecond)
}
func (s Settings) betweenKeys() time.Duration {
	return parseDuration(string(s.Pause.BetweenKeys), 8*time.Millisecond)
}
