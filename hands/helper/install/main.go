// Builds and installs only hands. Doesn't edit layouts or key bindings.
// From the mod's folder: go -C helper run ./install [--update]
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
)

const (
	mod    = "hands"
	title  = "Hands"
	binary = "hands"
)

// Stand-ins for tests.
var (
	lookPath           = exec.LookPath
	out      io.Writer = os.Stdout
	run                = func(dir string, env []string, args ...string) error {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), env...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
)

// root is the mod's folder in this repo, wherever the command was run from.
func root() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..")
}

func readManifest(folder string) (map[string]any, error) {
	b, err := os.ReadFile(filepath.Join(folder, "mod.json"))
	if err != nil {
		return nil, err
	}
	var manifest map[string]any
	return manifest, json.Unmarshal(b, &manifest)
}

// keepSettings writes a person's settings into the new manifest and returns the
// keys the new version no longer has.
// shortcut: the rewritten mod.json has its keys sorted, which only matters to someone reading it.
func keepSettings(path string, kept map[string]any) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fresh map[string]any
	if err := json.Unmarshal(b, &fresh); err != nil {
		return nil, err
	}
	defaults, _ := fresh["settings"].(map[string]any)
	if defaults == nil {
		defaults = map[string]any{}
		fresh["settings"] = defaults
	}
	dropped := merge(defaults, kept, "")
	slices.Sort(dropped)
	written, err := json.MarshalIndent(fresh, "", "  ")
	if err != nil {
		return nil, err
	}
	return dropped, os.WriteFile(path, append(written, '\n'), 0o644)
}

func merge(defaults, given map[string]any, path string) []string {
	dropped := []string{}
	for key, value := range given {
		name := path + key
		current, known := defaults[key]
		if !known {
			dropped = append(dropped, name)
			continue
		}
		inner, isMap := current.(map[string]any)
		givenInner, givenMap := value.(map[string]any)
		if isMap && givenMap {
			dropped = append(dropped, merge(inner, givenInner, name+".")...)
		} else {
			defaults[key] = value
		}
	}
	return dropped
}

func copyTree(from, to string) error {
	return filepath.WalkDir(from, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(to, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		return os.WriteFile(destination, b, info.Mode().Perm())
	})
}

func copyFile(from, to string) error {
	b, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, b, 0o755)
}

func install(appHome string, update bool, linkDir string) error {
	target := filepath.Join(appHome, "mods", mod)
	shipped, err := readManifest(filepath.Join(root(), "mods", mod))
	if err != nil {
		return err
	}
	var installed map[string]any
	info, err := os.Lstat(target)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("refusing to overwrite a symlink: %s", target)
	}
	if err == nil {
		found, readErr := readManifest(target)
		// Installs from before 0.5.1 are titled in lower case.
		if !update || readErr != nil || (found["title"] != title && found["title"] != "hands") {
			return fmt.Errorf("%s already exists; use --update only for an existing %s install", target, title)
		}
		installed = found
	}
	for _, program := range []string{"go", "clang", "herdr-app"} {
		if _, err := lookPath(program); err != nil {
			return fmt.Errorf("%s is required (Go 1.23+ and the Xcode command line tools build the helper)", program)
		}
	}
	// No third-party dependencies: cgo compiles the Objective-C bridge with the system frameworks.
	build, err := os.MkdirTemp("", mod+"-build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(build)
	built := filepath.Join(build, binary)
	if err := run(filepath.Join(root(), "helper"), []string{"CGO_ENABLED=1"}, "go", "build", "-o", built, "."); err != nil {
		return err
	}
	if err := copyTree(filepath.Join(root(), "mods", mod), target); err != nil {
		return err
	}
	if kept, _ := installed["settings"].(map[string]any); kept != nil {
		dropped, err := keepSettings(filepath.Join(target, "mod.json"), kept)
		if err != nil {
			return err
		}
		if len(dropped) > 0 {
			fmt.Fprintln(out, "Settings no longer used and dropped: "+strings.Join(dropped, ", "))
		}
	}
	bin := filepath.Join(target, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return err
	}
	// A new file, not a rewrite: macOS kills a signed binary changed in place.
	fresh := filepath.Join(bin, "."+binary+".new")
	if err := copyFile(built, fresh); err != nil {
		return err
	}
	if err := os.Rename(fresh, filepath.Join(bin, binary)); err != nil {
		return err
	}
	if err := run("", nil, "herdr-app", "check", target); err != nil {
		return err
	}
	change := ""
	if update {
		previous := "unversioned"
		if v, ok := installed["version"].(string); ok {
			previous = v
		}
		change = " (was " + previous + ")"
	}
	fmt.Fprintf(out, "Installed %s %v%s: %s\n", title, shipped["version"], change, target)
	if err := link(bin, linkDir); err != nil {
		return err
	}
	fmt.Fprintln(out, "Run `hands permissions --ask` from a Herdr terminal to grant Accessibility and Screen Recording to Herdr.")
	return nil
}

// link puts `hands` on PATH for agents in Herdr terminals, unless something else has the name.
func link(bin, linkDir string) error {
	path := filepath.Join(linkDir, binary)
	info, err := os.Lstat(path)
	if err == nil && info.Mode()&os.ModeSymlink == 0 {
		fmt.Fprintf(out, "Not linking: %s exists and is not a symlink. Add %s to PATH instead.\n", path, bin)
		return nil
	}
	if err == nil {
		if err := os.Remove(path); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(linkDir, 0o755); err != nil {
		return err
	}
	if err := os.Symlink(filepath.Join(bin, binary), path); err != nil {
		return err
	}
	fmt.Fprintf(out, "Linked %s -> %s\n", path, filepath.Join(bin, binary))
	if !slices.Contains(filepath.SplitList(os.Getenv("PATH")), linkDir) {
		fmt.Fprintf(out, "%s is not on PATH; add it so `hands` resolves in terminals.\n", linkDir)
	}
	return nil
}

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fallback := os.Getenv("HERDR_APP_HOME")
	if fallback == "" {
		fallback = filepath.Join(home, ".config/herdr-app")
	}
	appHome := flag.String("app-home", fallback, "Herdr's config folder")
	update := flag.Bool("update", false, "Update an existing "+title+" installation")
	linkDir := flag.String("link-dir", filepath.Join(home, ".local/bin"), "Where to symlink the hands binary")
	flag.Parse()
	if err := install(*appHome, *update, *linkDir); err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			fmt.Fprintln(os.Stderr, err)
		}
		fmt.Fprintln(os.Stderr, title+" installation failed")
		os.Exit(1)
	}
}
