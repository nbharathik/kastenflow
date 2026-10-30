// The Slides packages never depend on Kasten, so they can become a project of
// their own. Kasten reaches them only through what they export. This lists
// every place that breaks either rule; it exits 1 if there is any.
//
//   node scripts/check-boundaries.mjs
//
// What it checks:
//   - a package under packages/ imports nothing named kasten-*, @kasten/*, or
//     outside its own folder, and lists no such dependency;
//   - a Rust crate named slides-* has no kasten-* dependency;
//   - each of them is licensed Apache-2.0 and carries its LICENSE file;
//   - app/src reaches a Slides package by its name, or by a further entry
//   point the package lists in its "exports", never by a path inside it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = new Set(["node_modules", "pkg", "dist", "target", "generated"]);
const KASTEN = /^(?:kasten-|@kasten\/)/;

function* files(dir, test) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, test);
    else if (test(name)) yield path;
  }
}

function* imports(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(IMPORT)) yield { spec: m[2], line: i + 1 };
  }
}

/** Problems in one JavaScript package folder. */
function checkPackage(root, dir) {
  const problems = [];
  const at = (path, line, what) => problems.push(`${relative(root, path)}${line ? `:${line}` : ""}: ${what}`);
  const manifestPath = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.license !== "Apache-2.0") at(manifestPath, 0, `license is ${manifest.license ?? "missing"}, not Apache-2.0`);
  if (!existsSync(join(dir, "LICENSE"))) at(dir, 0, "has no LICENSE file");
  for (const kind of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(manifest[kind] ?? {})) if (KASTEN.test(name)) at(manifestPath, 0, `${kind} names ${name}, which is Kasten`);
  }
  for (const folder of ["src", "ts"]) {
    for (const file of files(join(dir, folder), (n) => SOURCE.test(n))) {
      for (const { spec, line } of imports(readFileSync(file, "utf8"))) {
        if (KASTEN.test(spec)) at(file, line, `imports ${spec}, which is Kasten`);
        else if (spec.startsWith(".") && relative(dir, resolve(dirname(file), spec)).startsWith("..")) at(file, line, `imports ${spec}, outside the package`);
      }
    }
  }
  return problems;
}

/** Problems in Rust crates named slides-*, from `cargo metadata --no-deps`. */
function checkCrates(root, metadata) {
  const problems = [];
  for (const pkg of metadata.packages) {
    if (!pkg.name.startsWith("slides-")) continue;
    const manifest = relative(root, pkg.manifest_path).split(sep).join("/");
    if (pkg.license !== "Apache-2.0") problems.push(`${manifest}: license is ${pkg.license ?? "missing"}, not Apache-2.0`);
    if (!existsSync(join(dirname(pkg.manifest_path), "LICENSE"))) problems.push(`${dirname(manifest)}: has no LICENSE file`);
    for (const dep of pkg.dependencies) if (dep.name.startsWith("kasten-")) problems.push(`${manifest}: depends on ${dep.name}, which is Kasten`);
  }
  return problems;
}

/** Every "name/sub" entry point the packages under packages/ export besides their main one. */
function exportedEntries(packages, names) {
  const entries = new Set();
  for (const name of names) {
    const manifestPath = join(packages, name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const exports = manifest.exports;
    if (!manifest.name || !exports || typeof exports !== "object") continue;
    for (const key of Object.keys(exports)) if (key.startsWith("./")) entries.add(`${manifest.name}/${key.slice(2)}`);
  }
  return entries;
}

/** Problems in the app: a deep import into a Slides package. */
function checkApp(root, entries) {
  const problems = [];
  for (const file of files(join(root, "app/src"), (n) => SOURCE.test(n))) {
    for (const { spec, line } of imports(readFileSync(file, "utf8"))) {
      if (/^@kasten-slides\/[^/]+\/./.test(spec) && !entries.has(spec)) problems.push(`${relative(root, file)}:${line}: imports ${spec}; use the package's own entry point`);
    }
  }
  return problems;
}

/** Every problem under `root`. `metadata` is the output of `cargo metadata --no-deps`, parsed. */
export function checkBoundaries(root, metadata) {
  const problems = [];
  const packages = join(root, "packages");
  let names = [];
  try {
    names = readdirSync(packages);
  } catch {
    // No packages folder, nothing to check there.
  }
  for (const name of names) {
    if (existsSync(join(packages, name, "package.json"))) problems.push(...checkPackage(root, join(packages, name)));
  }
  problems.push(...checkCrates(root, metadata));
  problems.push(...checkApp(root, exportedEntries(packages, names)));
  return problems;
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  const out = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--offline"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) {
    console.error(out.stderr);
    process.exit(out.status ?? 1);
  }
  const problems = checkBoundaries(root, JSON.parse(out.stdout));
  if (problems.length === 0) {
    console.log("The Slides packages import nothing from Kasten.");
    return;
  }
  for (const p of problems) console.log(p);
  console.log(`\n${problems.length} boundary problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
