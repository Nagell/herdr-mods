// What the folder, Git and editors say, as plain data. No drawing and no side effects.
export const PER_FOLDER = 500;
export const TOTAL_ROWS = 5000;
export const MAX_CHARS = 400000;

// Editors found by app ID: a Nix or per-user install isn't in /Applications.
// More can be added under `settings.editors` in mod.json.
export const EDITORS = [
  { name: "Zed", bundle: "dev.zed.Zed" },
  { name: "VS Code", bundle: "com.microsoft.VSCode" },
  { name: "Cursor", bundle: "com.todesktop.230313mzl4w4u92" },
  { name: "Windsurf", bundle: "com.exafunction.windsurf" },
  { name: "Sublime Text", bundle: "com.sublimetext.4" },
  { name: "Nova", bundle: "com.panic.Nova" },
];

const LANGUAGES = {
  ts: "js",
  tsx: "js",
  mts: "js",
  cts: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  toml: "yaml",
  jsonc: "json",
  svelte: "html",
  vue: "html",
};

export const baseName = (path) => path.split("/").pop();
export const parentOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";

export function languageOf(path) {
  const name = baseName(path);
  const ext = name.includes(".") ? name.split(".").pop() : "txt";
  return LANGUAGES[ext] ?? ext;
}

// Directories first, each kind by name, the way a file browser reads.
export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
  );
}

// `git status --porcelain=v1 -z`, keyed by absolute path. `staged` is true when the only
// change is in the index, which is where a diff of it has to look.
export function parseStatus(stdout, top) {
  const marks = {};
  for (const entry of stdout.split("\0").filter(Boolean).slice(0, TOTAL_ROWS)) {
    const xy = entry.slice(0, 2);
    const untracked = xy === "??";
    marks[`${top}/${entry.slice(3)}`] = {
      mark: untracked || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M",
      staged: !untracked && xy[0] !== " " && xy[1] === " ",
    };
  }
  return marks;
}

// `git diff -U0` as gutter marks, by 0-based line in the file as it is now. A hunk with new
// lines and none removed is added; with both, changed; with only removed lines, there's no
// line to colour, so it marks the place they were.
export function parseHunks(diff) {
  const marks = [];
  for (const [, removed, start, added] of diff.matchAll(
    /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const gone = removed === undefined ? 1 : Number(removed);
    const fresh = added === undefined ? 1 : Number(added);
    const first = Number(start);
    if (!fresh) marks.push({ line: first, count: 0, kind: "removed" });
    else marks.push({ line: first - 1, count: fresh, kind: gone ? "changed" : "added" });
  }
  return marks;
}

// A folder holds a change if any changed file is inside it.
export const holdsChange = (marks, folder) =>
  Object.keys(marks).some((path) => path.startsWith(`${folder}/`));

// Read-only view text: what can't be shown says why.
export function viewable(text) {
  if (text === null) return { problem: "This file is no longer available." };
  if (text.includes("\0")) return { problem: "This is a binary file, so there's no text to show." };
  return text.length > MAX_CHARS
    ? { text: `${text.slice(0, MAX_CHARS)}\n… (file truncated)` }
    : { text };
}
