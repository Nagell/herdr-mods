package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// fakeTools stands in for Go and herdr-app, recording what ran.
func fakeTools(t *testing.T) (*bytes.Buffer, *[][]string) {
	t.Helper()
	printed, calls := &bytes.Buffer{}, &[][]string{}
	oldRun, oldLook, oldOut := run, lookPath, out
	t.Cleanup(func() { run, lookPath, out = oldRun, oldLook, oldOut })
	out = printed
	lookPath = func(string) (string, error) { return "available", nil }
	run = func(_ string, _ []string, args ...string) error {
		*calls = append(*calls, args)
		if args[0] == "go" {
			return os.WriteFile(args[3], []byte("built helper"), 0o755)
		}
		return nil
	}
	return printed, calls
}

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestInstallsAndUpdatesWithoutTouchingAnythingElse(t *testing.T) {
	printed, calls := fakeTools(t)
	app := filepath.Join(t.TempDir(), "app")
	write(t, filepath.Join(app, "layouts/personal.json"), `{"personal":true}`)
	write(t, filepath.Join(app, "keys.json"), `{"global":{"cmd-p":"custom"}}`)
	write(t, filepath.Join(app, "mods/independent/main.js"), "// personal")
	if err := install(app, false, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(app, "mods", mod)
	if got := read(t, filepath.Join(target, "bin", binary)); got != "built helper" {
		t.Fatalf("binary = %q", got)
	}
	if _, err := os.Stat(filepath.Join(target, "main.js")); err != nil {
		t.Fatal(err)
	}
	checked := false
	for _, call := range *calls {
		checked = checked || (call[0] == "herdr-app" && call[1] == "check")
	}
	if !checked {
		t.Fatalf("ran %v", *calls)
	}
	if err := install(app, false, t.TempDir()); err == nil {
		t.Fatal("a second install needs --update")
	}
	if err := install(app, true, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`Installed .* \d+\.\d+\.\d+ \(was \d+\.\d+\.\d+\)`).MatchString(printed.String()) {
		t.Fatalf("printed %q", printed)
	}
	if read(t, filepath.Join(app, "layouts/personal.json")) != `{"personal":true}` ||
		read(t, filepath.Join(app, "keys.json")) != `{"global":{"cmd-p":"custom"}}` ||
		read(t, filepath.Join(app, "mods/independent/main.js")) != "// personal" {
		t.Fatal("something else changed")
	}
}

func TestUpdateKeepsEditedSettingsAndReportsStaleKeys(t *testing.T) {
	printed, _ := fakeTools(t)
	app := t.TempDir()
	target := filepath.Join(app, "mods", mod)
	shipped, err := readManifest(filepath.Join(root(), "mods", mod))
	if err != nil {
		t.Fatal(err)
	}
	first := ""
	for key := range knownSettings(filepath.Join(root(), "mods", mod), nil) {
		first = key
		break
	}
	if first == "" {
		t.Fatal("mod.schema.json describes no settings")
	}
	edited := map[string]any{"title": title, "version": "0.0.1", "settings": map[string]any{first: "edited", "gone": true}}
	b, _ := json.Marshal(edited)
	write(t, filepath.Join(target, "mod.json"), string(b))
	if err := install(app, true, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	got, err := readManifest(target)
	if err != nil {
		t.Fatal(err)
	}
	kept := got["settings"].(map[string]any)
	if got["version"] != shipped["version"] || kept[first] != "edited" || kept["gone"] != nil || len(kept) != 1 {
		t.Fatalf("manifest = %v", got)
	}
	if !strings.Contains(printed.String(), "dropped: gone") {
		t.Fatalf("printed %q", printed)
	}
}

func TestNestedSettingsMergeKeepOnlyChangesAndNameWhatIsDropped(t *testing.T) {
	known := map[string]any{"a": map[string]any{"b": 1.0, "c": 2.0}}
	settings := map[string]any{}
	dropped := merge(settings, known, map[string]any{"a": map[string]any{"b": 9.0, "c": 2.0, "old": true}}, "")
	inner := settings["a"].(map[string]any)
	if inner["b"] != 9.0 || len(inner) != 1 || len(dropped) != 1 || dropped[0] != "a.old" {
		t.Fatalf("settings %v, dropped %v", settings, dropped)
	}
}

func TestUnrelatedFoldersAndSymlinksAreNeverOverwritten(t *testing.T) {
	fakeTools(t)
	app := t.TempDir()
	target := filepath.Join(app, "mods", mod)
	write(t, filepath.Join(target, "mod.json"), `{"title":"Personal"}`)
	if err := install(app, true, t.TempDir()); err == nil {
		t.Fatal("overwrote someone else's folder")
	}
	if got := read(t, filepath.Join(target, "mod.json")); got != `{"title":"Personal"}` {
		t.Fatalf("mod.json = %q", got)
	}
	if err := os.RemoveAll(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(app, target); err != nil {
		t.Fatal(err)
	}
	if err := install(app, true, t.TempDir()); err == nil {
		t.Fatal("overwrote a symlink")
	}
}

func TestMissingToolsFailBeforeCopying(t *testing.T) {
	fakeTools(t)
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	app := t.TempDir()
	if err := install(app, false, t.TempDir()); err == nil {
		t.Fatal("installed without its tools")
	}
	if _, err := os.Stat(filepath.Join(app, "mods", mod)); err == nil {
		t.Fatal("copied before checking")
	}
}

func TestWritesTheSkillButNeverOverAnotherOne(t *testing.T) {
	printed, calls := fakeTools(t)
	skills := t.TempDir()
	if err := install(t.TempDir(), false, skills); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(skills, mod, "SKILL.md")
	if !strings.Contains(read(t, path), "name: factory") {
		t.Fatal("no skill")
	}
	if last := (*calls)[len(*calls)-1]; last[len(last)-1] != "init" {
		t.Fatalf("last ran %v", last)
	}
	write(t, path, "---\nname: other\n---\n")
	if err := install(t.TempDir(), false, skills); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(read(t, path), "name: other") || !strings.Contains(printed.String(), "Not writing the skill") {
		t.Fatalf("printed %q", printed)
	}
}
