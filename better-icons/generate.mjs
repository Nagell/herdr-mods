#!/usr/bin/env node
// Builds mods/better-icons/ from the Material Icon Theme package: icons.json, the icons it
// names, and the theme's licence. Run it on the unpacked package, for example:
//   npm pack material-icon-theme@5.40.0 && tar xzf material-icon-theme-5.40.0.tgz
//   node generate.mjs package
// It reads only the package's JSON and SVG files, and runs none of its code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "5.40.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "mods/better-icons");

const source = process.argv[2];
if (!source) {
  console.error("usage: node generate.mjs <unpacked material-icon-theme package>");
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
if (pkg.name !== "material-icon-theme" || pkg.version !== VERSION) {
  console.error(`expected material-icon-theme ${VERSION}, found ${pkg.name} ${pkg.version}`);
  process.exit(1);
}
const theme = JSON.parse(fs.readFileSync(path.join(source, "dist/material-icons.json"), "utf8"));

// An icon's name is its SVG's file name, which isn't always its id in the theme.
const fileOf = (id) => {
  const def = theme.iconDefinitions[id];
  if (!def) throw new Error(`no icon definition for ${id}`);
  return path.basename(def.iconPath, ".svg");
};

// VS Code matches names in lower case, so the tables use lower-case keys.
const lowered = (table = {}) => {
  const result = {};
  for (const [key, id] of Object.entries(table)) {
    const lower = key.toLowerCase();
    if (lower in result && result[lower] !== fileOf(id)) throw new Error(`${key} clashes with another case`);
    result[lower] = fileOf(id);
  }
  return result;
};

// Every folder icon has an open one; the table keeps each pair once instead of a second
// table of 4,000 open names.
const open = {};
const pairFolders = (closed = {}, expanded = {}) => {
  for (const [name, id] of Object.entries(closed)) {
    const shut = fileOf(id);
    const opened = fileOf(expanded[name] ?? id);
    if (open[shut] && open[shut] !== opened) throw new Error(`${shut} opens as two icons`);
    open[shut] = opened;
  }
};
pairFolders({ folder: theme.folder }, { folder: theme.folderExpanded });
pairFolders(theme.folderNames, theme.folderNamesExpanded);
pairFolders(theme.light.folderNames, theme.light.folderNamesExpanded);

const table = {
  source: `material-icon-theme ${VERSION}`,
  file: fileOf(theme.file),
  folder: fileOf(theme.folder),
  fileNames: lowered(theme.fileNames),
  fileExtensions: lowered(theme.fileExtensions),
  folderNames: lowered(theme.folderNames),
  open,
  light: {
    fileNames: lowered(theme.light.fileNames),
    fileExtensions: lowered(theme.light.fileExtensions),
    folderNames: lowered(theme.light.folderNames),
  },
};

const used = new Set([table.file, table.folder, ...Object.values(open)]);
for (const map of [table.fileNames, table.fileExtensions, table.folderNames, ...Object.values(table.light)])
  for (const name of Object.values(map)) used.add(name);
for (const name of Object.keys(open)) used.add(name);

fs.rmSync(path.join(out, "icons"), { recursive: true, force: true });
fs.mkdirSync(path.join(out, "icons"), { recursive: true });
for (const name of [...used].sort())
  fs.copyFileSync(path.join(source, "icons", `${name}.svg`), path.join(out, "icons", `${name}.svg`));
fs.writeFileSync(path.join(out, "icons.json"), `${JSON.stringify(table)}\n`);
fs.copyFileSync(path.join(source, "LICENSE"), path.join(out, "LICENSE-material-icon-theme.txt"));
console.log(`${used.size} icons from material-icon-theme ${VERSION} in ${path.relative(process.cwd(), out)}`);
