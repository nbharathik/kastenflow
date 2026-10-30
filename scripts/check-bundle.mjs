// The first-page bundle gate: reads the Vite build manifest and fails when
// what a window loads before it can draw (an entry's own chunk, the chunks it
// imports at once, and their styles) is over the budget in gzip.
//
//   node scripts/check-bundle.mjs [build-dir]      (default: app/dist)
//
// Lazy chunks (dynamic imports) are listed for the report but never counted.
// With GITHUB_STEP_SUMMARY set, the report is added to the job summary too.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Gzip kilobytes (1 kB = 1000 bytes) an entry may load up front, when it has no budget of its own. */
export const BUDGET_KB = 300;

/** Budgets per entry, set just above the sizes measured on 2026-10-29 after the lazy overlays and
 * the narrow presenter entry (main 329.6, presenter 150.9, capture 107.6; before: 339.2, 663.5,
 * 107.6) so growth fails now. Lower them as code goes lazy. */
export const BUDGETS = { "index.html": 330, "presenter.html": 156, "capture.html": 113 };

/** The files an entry loads at once: itself, its static imports (any depth) and their styles. */
export function firstPageFiles(manifest, key) {
  const files = new Set();
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name) || !manifest[name]) return;
    seen.add(name);
    const chunk = manifest[name];
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const next of chunk.imports ?? []) visit(next);
  };
  visit(key);
  return [...files];
}

/** Per entry: its files with gzip sizes and the total. `sizeOf(file)` gives gzip bytes. */
export function measure(manifest, sizeOf) {
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
  return entries.map(([key, chunk]) => {
    const files = firstPageFiles(manifest, key).map((file) => ({ file, bytes: sizeOf(file) }));
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    return { entry: chunk.src ?? key, files, total };
  });
}

export function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/** The report as Markdown, and whether every entry is within its budget. `budget` is one
 * number for all entries, or kilobytes by entry with BUDGET_KB for the rest. */
export function report(results, budget = BUDGETS) {
  const lines = [];
  let ok = true;
  for (const { entry, files, total } of results) {
    const budgetKb = typeof budget === "number" ? budget : (budget[entry] ?? BUDGET_KB);
    const over = total > budgetKb * 1000;
    if (over) ok = false;
    lines.push(`### ${entry}: ${kb(total)} gzip of ${budgetKb} kB${over ? " (OVER BUDGET)" : ""}`, "", "| File | Gzip |", "|---|---:|");
    for (const f of [...files].sort((a, b) => b.bytes - a.bytes)) lines.push(`| ${f.file} | ${kb(f.bytes)} |`);
    lines.push("");
  }
  return { text: lines.join("\n"), ok };
}

function main() {
  const dir = process.argv[2] ?? "app/dist";
  const path = join(dir, ".vite", "manifest.json");
  if (!existsSync(path)) {
    console.error(`No build manifest at ${path}. Build first: pnpm -C app exec vite build`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const results = measure(manifest, (file) => gzipSync(readFileSync(join(dir, file))).length);
  const { text, ok } = report(results);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## First-page bundle\n\n${text}\n`);
  if (!ok) {
    console.error("An entry loads more than its budget in gzip up front. Make the new code lazy.");
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
