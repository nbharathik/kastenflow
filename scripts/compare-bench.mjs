// Compares two saved Criterion runs and fails when a bench got slower by more
// than the limit.
//
//   node scripts/compare-bench.mjs [criterion-dir] [--baseline main] [--current new]
//                                  [--limit 20] [--only "search"]...
//
// Criterion keeps each run of a bench in <group>/<bench>/<run name>/estimates.json
// (the run `new` is the latest one; `--save-baseline main` writes `main`).
// The median is compared: it moves less than the mean when a runner is noisy.
// With GITHUB_STEP_SUMMARY set, the table is added to the job summary too.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** A bench may get this many percent slower before the job fails. */
export const LIMIT_PERCENT = 20;

/** The median time of one run in nanoseconds, or null when the file has none. */
export function readEstimate(path) {
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const value = (json.median ?? json.mean)?.point_estimate;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Every bench folder under `root` that has both runs: [{ name, base, current }]. */
export function collect(root, baseline, current) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "report") continue;
      const path = join(dir, entry);
      if (!statSync(path).isDirectory()) continue;
      const base = join(path, baseline, "estimates.json");
      const now = join(path, current, "estimates.json");
      if (existsSync(base) && existsSync(now)) {
        const b = readEstimate(base);
        const c = readEstimate(now);
        if (b !== null && c !== null) found.push({ name: relative(root, path).split(sep).join("/"), base: b, current: c });
      } else {
        walk(path);
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Adds the change in percent and whether it is over the limit. `only` keeps benches whose name has one of its words. */
export function judge(rows, limit = LIMIT_PERCENT, only = []) {
  return rows
    .filter((row) => only.length === 0 || only.some((word) => row.name.toLowerCase().includes(word.toLowerCase())))
    .map((row) => {
      const change = row.base > 0 ? ((row.current - row.base) / row.base) * 100 : 0;
      return { ...row, change, failed: change > limit };
    });
}

export function formatTime(ns) {
  if (ns >= 1e9) return `${(ns / 1e9).toFixed(2)} s`;
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
  return `${ns.toFixed(0)} ns`;
}

/** A Markdown table, the slowest changes first. */
export function table(rows, limit = LIMIT_PERCENT) {
  const lines = [`| Bench | Saved | Now | Change | Limit ${limit}% |`, "|---|---:|---:|---:|:---:|"];
  for (const row of [...rows].sort((a, b) => b.change - a.change)) {
    const sign = row.change > 0 ? "+" : "";
    lines.push(`| ${row.name} | ${formatTime(row.base)} | ${formatTime(row.current)} | ${sign}${row.change.toFixed(1)}% | ${row.failed ? "FAIL" : "ok"} |`);
  }
  return lines.join("\n");
}

function parse(argv) {
  const options = { root: "target/criterion", baseline: "main", current: "new", limit: LIMIT_PERCENT, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--baseline") options.baseline = argv[++i];
    else if (arg === "--current") options.current = argv[++i];
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--only") options.only.push(argv[++i]);
    else options.root = arg;
  }
  return options;
}

function main() {
  const options = parse(process.argv.slice(2));
  if (!existsSync(options.root)) {
    console.error(`No Criterion results in ${options.root}.`);
    process.exit(2);
  }
  const rows = judge(collect(options.root, options.baseline, options.current), options.limit, options.only);
  if (rows.length === 0) {
    console.error(`No bench has both a "${options.baseline}" and a "${options.current}" run.`);
    process.exit(2);
  }
  const failed = rows.filter((row) => row.failed);
  const text = `${table(rows, options.limit)}\n\n${failed.length === 0 ? `All ${rows.length} benches are within ${options.limit}%.` : `${failed.length} of ${rows.length} benches are over ${options.limit}% slower.`}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Bench comparison\n\n${text}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
