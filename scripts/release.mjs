// The owner's release helper: the same steps as dev/releasing.md, as three
// commands. It only reads, dispatches CI and pushes a tag; it never commits,
// merges, rebases or force-pushes, and it never moves a tag.
//
//   node scripts/release.mjs check [x.y.z]   what is ready and what is not, for the current commit
//   node scripts/release.mjs ci              start the full CI by hand on the current branch
//   node scripts/release.mjs tag [x.y.z] [--yes]   tag this commit vX.Y.Z and push the tag
//
// The version defaults to the workspace's. `tag` only goes ahead when the work
// tree is clean, the commit is on origin, the versions agree and a full CI run
// started by hand on this very commit has passed (the Release workflow looks
// for exactly that run, then builds at once). Pushing the tag starts the
// Release workflow; you then approve the `release` environment and publish the
// draft by hand.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryRun = (cmd, args) => {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
};

/** What stands in the way of tagging, in words, from what was observed. Pure, so a test can feed it. */
export function problems(state) {
  const out = [];
  if (!state.branch) out.push("HEAD is not on a branch");
  if (state.dirty) out.push("the work tree has uncommitted changes: commit them first");
  if (!state.pushed) out.push(`this commit is not on origin: push ${state.branch ?? "the branch"} first`);
  if (state.version && state.workspace !== state.version) out.push(`the workspace is version ${state.workspace}, not ${state.version}`);
  if (state.packageVersion !== state.workspace) out.push(`app/package.json is ${state.packageVersion}, the workspace ${state.workspace}`);
  if (state.tagExists) out.push(`tag v${state.workspace} already exists: never move a published tag; release the next patch`);
  if (!state.pubkey) out.push("plugins.updater.pubkey is missing in app/src-tauri/tauri.conf.json");
  if (state.clientId === false) out.push("the repository variable KASTEN_GITHUB_CLIENT_ID is not set (Settings → Secrets and variables → Actions → Variables)");
  if (!state.ciPassed) out.push("no full CI run started by hand has passed on this commit: run `node scripts/release.mjs ci`, wait for green");
  return out;
}

/** What is worth knowing but does not stop the tag. */
export function notes(state) {
  const out = [];
  if (state.pinsTodo) out.push("the Tectonic pins are still TODO_PIN: LaTeX works with the user's own TeX, but \"Download Tectonic\" is not offered");
  if (state.ciPending) out.push("a full CI run on this commit is still running");
  return out;
}

function observe(version) {
  const branch = tryRun("git", ["symbolic-ref", "--short", "-q", "HEAD"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  const workspace = run("node", ["scripts/check-version.mjs", "--print"]);
  const config = JSON.parse(readFileSync("app/src-tauri/tauri.conf.json", "utf8"));
  const pins = readFileSync("app/src-tauri/src/plugins/latex/pinned.rs", "utf8");
  const remote = tryRun("git", ["branch", "-r", "--contains", head]);
  const runs = tryRun("gh", ["api", `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=${head}&event=workflow_dispatch`, "--jq", "[.workflow_runs[] | {status, conclusion}]"]);
  const list = runs ? JSON.parse(runs) : [];
  const clientId = tryRun("gh", ["variable", "get", "KASTEN_GITHUB_CLIENT_ID"]);
  return {
    branch,
    head,
    version,
    workspace,
    packageVersion: JSON.parse(readFileSync("app/package.json", "utf8")).version,
    dirty: run("git", ["status", "--porcelain"]) !== "",
    pushed: Boolean(remote && remote.includes("origin/")),
    tagExists: tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/v${workspace}`]) !== null,
    pubkey: Boolean(config?.plugins?.updater?.pubkey?.trim()),
    clientId: clientId === null ? null : clientId.length > 0,
    ciPassed: list.some((r) => r.status === "completed" && r.conclusion === "success"),
    ciPending: list.some((r) => r.status !== "completed"),
    pinsTodo: /sha256:\s*TODO_PIN/.test(pins),
  };
}

function report(state) {
  console.log(`Commit ${state.head.slice(0, 9)} on ${state.branch ?? "(detached)"}, version ${state.workspace}`);
  const stops = problems(state);
  for (const note of notes(state)) console.log(`  note: ${note}`);
  if (state.clientId === null) console.log("  note: could not read the repository variable (is gh signed in?); the release build checks it too");
  if (stops.length === 0) {
    console.log(`Ready: \`node scripts/release.mjs tag --yes\` tags v${state.workspace} and starts the release.`);
    return true;
  }
  console.log("Not ready:");
  for (const stop of stops) console.log(`  - ${stop}`);
  return false;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const version = rest.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? null;
  if (command === "ci") {
    const branch = run("git", ["symbolic-ref", "--short", "HEAD"]);
    run("gh", ["workflow", "run", "ci.yml", "--ref", branch]);
    console.log(`Started the full CI on ${branch}. Watch it: gh run watch (or Actions → CI). When it is green, run: node scripts/release.mjs check`);
    return;
  }
  if (command !== "check" && command !== "tag") {
    console.error("usage: release.mjs check [x.y.z] | ci | tag [x.y.z] [--yes]");
    process.exit(2);
  }
  const state = observe(version);
  const ready = report(state);
  if (command === "check") process.exit(ready ? 0 : 1);
  if (!ready) process.exit(1);
  if (!rest.includes("--yes")) {
    console.log(`Dry run: add --yes to tag v${state.workspace} and push it.`);
    return;
  }
  const tag = `v${state.workspace}`;
  run("node", ["scripts/check-version.mjs", tag]);
  run("git", ["tag", tag]);
  run("git", ["push", "origin", tag]);
  console.log(`Pushed ${tag}. Next: Actions → Release → approve the \`release\` environment when asked, then try the draft release and publish it.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
