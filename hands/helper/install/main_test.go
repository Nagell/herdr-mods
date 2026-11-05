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
	if last := (*calls)[len(*calls)-1]; last[0] != "herdr-app" || last[1] != "check" {
		t.Fatalf("last ran %v", last)
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
	settings := shipped["settings"].(map[string]any)
	first := ""
	for key := range settings {
		first = key
		break
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
	if got["version"] != shipped["version"] || kept[first] != "edited" || kept["gone"] != nil {
		t.Fatalf("manifest = %v", got)
	}
	if !strings.Contains(printed.String(), "dropped: gone") {
		t.Fatalf("printed %q", printed)
	}
}

func TestNestedSettingsMergeAndNameWhatIsDropped(t *testing.T) {
	defaults := map[string]any{"a": map[string]any{"b": 1.0, "c": 2.0}}
	dropped := merge(defaults, map[string]any{"a": map[string]any{"b": 9.0, "old": true}}, "")
	inner := defaults["a"].(map[string]any)
	if inner["b"] != 9.0 || inner["c"] != 2.0 || len(dropped) != 1 || dropped[0] != "a.old" {
		t.Fatalf("defaults %v, dropped %v", defaults, dropped)
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

func TestLinksTheBinaryAndLeavesARealFileAlone(t *testing.T) {
	printed, _ := fakeTools(t)
	app, links := t.TempDir(), t.TempDir()
	if err := install(app, false, links); err != nil {
		t.Fatal(err)
	}
	got, err := os.Readlink(filepath.Join(links, binary))
	if err != nil || got != filepath.Join(app, "mods", mod, "bin", binary) {
		t.Fatalf("link = %q, %v", got, err)
	}
	other := t.TempDir()
	write(t, filepath.Join(other, binary), "someone else's hands")
	if err := install(t.TempDir(), false, other); err != nil {
		t.Fatal(err)
	}
	if read(t, filepath.Join(other, binary)) != "someone else's hands" || !strings.Contains(printed.String(), "Not linking") {
		t.Fatalf("printed %q", printed)
	}
}
