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

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
export const isImage = (path) => {
  const name = baseName(path);
  return name.includes(".") && IMAGES.has(name.split(".").pop().toLowerCase());
};


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

// `git diff -U0` as changes, by 0-based line in the file as it is now, each with the old
// lines it replaced. A hunk with new lines and none removed is added; with both, changed;
// with only removed lines, there's no line to colour, so it marks the place they were.
export function parseHunks(diff) {
  const hunks = [];
  let current = null;
  for (const text of diff.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (header) {
      const [, oldStart, removed, start, added] = header;
      const gone = removed === undefined ? 1 : Number(removed);
      const fresh = added === undefined ? 1 : Number(added);
      current = {
        line: fresh ? Number(start) - 1 : Number(start),
        count: fresh,
        kind: !fresh ? "removed" : gone ? "changed" : "added",
        oldStart: Number(oldStart),
        old: [],
      };
      hunks.push(current);
    } else if (current && text.startsWith("-")) current.old.push(text.slice(1));
  }
  return hunks;
}

const cleanLine = (line) => line.replace(/\r$/, "").replace(/\t/g, "    ");
export const fileLinesOf = (text) => text.split("\n").map(cleanLine);

// What to draw, top to bottom: the file's lines, and where a change is open, the lines it
// replaced. A closed removal is a thin row of its own, so it can be clicked without a line.
export function buildRows(lines, hunks, open) {
  const covering = new Map();
  const startingAt = new Map();
  const removedAt = new Map();
  for (const hunk of hunks) {
    if (hunk.kind === "removed") removedAt.set(Math.min(hunk.line, lines.length), hunk);
    else {
      startingAt.set(hunk.line, hunk);
      for (let i = hunk.line; i < Math.min(hunk.line + (hunk.count ?? lines.length), lines.length); i++)
        covering.set(i, hunk);
    }
  }
  const rows = [];
  const oldRows = (hunk) =>
    hunk.old.forEach((text, n) =>
      rows.push({
        key: `old-${hunk.oldStart + n}`,
        type: "old",
        number: hunk.oldStart + n,
        text: cleanLine(text),
        hunk,
      }),
    );
  for (let i = 0; i <= lines.length; i++) {
    const removal = removedAt.get(i);
    if (removal) {
      if (open.has(hunkKey(removal))) oldRows(removal);
      else rows.push({ key: `removed-${i}`, type: "removed", hunk: removal });
    }
    const starting = startingAt.get(i);
    if (starting && open.has(hunkKey(starting))) oldRows(starting);
    if (i < lines.length)
      rows.push({ key: `line-${i}`, type: "line", number: i + 1, text: lines[i], hunk: covering.get(i) });
  }
  return rows;
}

export const hunkKey = (hunk) => `${hunk.kind}-${hunk.oldStart}`;

const LINE_COMMENT = { py: "#", rb: "#", sh: "#", bash: "#", zsh: "#", yaml: "#", yml: "#", nix: "#", lua: "--", sql: "--" };
const UNCOLOURED = new Set(["txt", "md", "markdown", "log", "csv"]);
const KEYWORDS = new Set(
  "as async await break case catch class const continue def default defer do elif else enum export extends false fn for from func function go if impl import in interface let match mod new nil none not null package pub return self struct switch this throw true try type undefined use var while with yield".split(" "),
);
const TOKEN = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?|\b\d[\d_.xa-fA-F]*\b|[A-Za-z_][A-Za-z0-9_]*/g;
const HIGHLIGHT_CHARS = 2000;

// A line as coloured runs, for the view that draws rows.
// shortcut: one line at a time, so a block comment or multi-line string is only coloured where a
// line alone shows it; carry state between lines if that gets in the way.
export function tokenize(line, language) {
  if (UNCOLOURED.has(language) || line.length > HIGHLIGHT_CHARS) return [{ text: line, kind: null }];
  const marker = LINE_COMMENT[language] ?? "//";
  const runs = [];
  let at = 0;
  const plain = (end) => {
    if (end > at) runs.push({ text: line.slice(at, end), kind: null });
  };
  for (const match of line.matchAll(TOKEN)) {
    const before = line.slice(at, match.index);
    const comment = before.indexOf(marker);
    if (comment >= 0) break;
    const word = match[0];
    const first = word[0];
    const kind = first === '"' || first === "'" || first === "`" ? "string" : /\d/.test(first) ? "number" : KEYWORDS.has(word) ? "keyword" : null;
    if (!kind) continue;
    plain(match.index);
    runs.push({ text: word, kind });
    at = match.index + word.length;
  }
  const comment = line.indexOf(marker, at);
  if (comment >= 0) {
    plain(comment);
    runs.push({ text: line.slice(comment), kind: "comment" });
  } else plain(line.length);
  return runs.length ? runs : [{ text: "", kind: null }];
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
