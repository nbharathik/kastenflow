// Third-party notices for the app, the CLI and the MCP server:
// every Rust crate and npm package they ship, with its licence and the
// licence texts its authors ask to be passed on. Written into app/public so
// the app carries it and Settings shows it; release builds regenerate it.
//
//   node scripts/notices.mjs [out=app/public/third-party-notices.txt]

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const out = process.argv[2] ?? "app/public/third-party-notices.txt";
const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._ ].*)?$/i;

/** The licence and notice files at the top of a package's folder. */
function texts(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name))
    .sort()
    .map((name) => {
      try {
        return readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").trim();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

// On Windows pnpm is a .cmd shim, which Node starts only through a shell.
// The arguments are fixed words, so the command line is them joined.
const run = (cmd, args) => {
  const options = { maxBuffer: 1 << 28 };
  return (process.platform === "win32" ? execSync([cmd, ...args].join(" "), options) : execFileSync(cmd, args, options)).toString();
};

// Rust: normal dependencies reachable from the workspace's crates. Build
// scripts and dev dependencies are not shipped.
const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--locked"]));
const packages = new Map(meta.packages.map((p) => [p.id, p]));
const graph = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const members = new Set(meta.workspace_members);
const reached = new Set();
const todo = [...members];
while (todo.length > 0) {
  const id = todo.pop();
  if (reached.has(id)) continue;
  reached.add(id);
  for (const dep of graph.get(id)?.deps ?? []) if (dep.dep_kinds.some((k) => k.kind === null)) todo.push(dep.pkg);
}
const crates = [...reached]
  .filter((id) => !members.has(id))
  .map((id) => packages.get(id))
  .map((p) => ({ name: p.name, version: p.version, licence: p.license ?? p.license_file ?? "see its files", home: p.repository ?? p.homepage ?? "", texts: texts(dirname(p.manifest_path)) }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// npm: the app's production packages.
const byLicence = JSON.parse(run("pnpm", ["-C", "app", "licenses", "list", "--prod", "--json"]));
const npm = Object.values(byLicence)
  .flat()
  .map((p) => ({ name: p.name, version: p.versions.join(", "), licence: p.license, home: p.homepage ?? "", texts: p.paths.flatMap(texts) }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Work copied into the app's own source, rather than installed.
const icons = readFileSync("app/src/ui/icons.ts", "utf8").match(/Lucide ([\d.]+)/)?.[1] ?? "";
const copied = [
  { name: "lucide-static (icon drawings, in app/src/ui/icons.ts)", version: icons, licence: "ISC", home: "https://lucide.dev", texts: texts("app/src/ui").filter((t) => t.startsWith("ISC")) },
  { name: "Inter (the app's typeface, in app/src/assets/fonts/inter)", version: "4.1", licence: "OFL-1.1", home: "https://rsms.me/inter/", texts: texts("app/src/assets/fonts/inter") },
];

// One copy of each licence text, with the packages it covers.
const shared = new Map();
for (const item of [...crates, ...npm, ...copied]) {
  for (const text of item.texts) {
    const key = text.replace(/\s+/g, " ");
    const entry = shared.get(key) ?? { text, users: [] };
    entry.users.push(`${item.name} ${item.version}`);
    shared.set(key, entry);
  }
}

const line = (item) => `${item.name} ${item.version} (${item.licence})${item.home ? ` ${item.home}` : ""}${item.texts.length ? "" : " [no licence file in the package]"}`;
const parts = [
  "KastenFlow is MIT-licensed. It includes the open-source software below, whose licences follow.",
  "A package marked [no licence file] ships none of its own; the licence it names applies in its standard text.",
  "",
  `Rust crates (${crates.length})`,
  "",
  ...crates.map(line),
  "",
  `npm packages (${npm.length})`,
  "",
  ...npm.map(line),
  "",
  `Copied into the source (${copied.length})`,
  "",
  ...copied.map(line),
  "",
  "Licence texts",
  ...[...shared.values()].flatMap((entry) => ["", "-".repeat(72), `Used by: ${[...new Set(entry.users)].join(", ")}`, "", entry.text]),
  "",
];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join("\n"));
console.log(`${out}: ${crates.length} crates, ${npm.length} npm packages, ${shared.size} licence texts, ${Math.round(parts.join("\n").length / 1024)} KB`);
