// The health report as the sections of a page. Each section says how things
// stand in a word (its level) and a sentence, and lists what to look at: where
// each issue opens, and, where there is one, the repair it offers (a preview
// of an existing operation; nothing is done from here). Pure: it reads what it
// is given and changes nothing.

import { relativeTime } from "../../lib/dates";
import type { Health } from "../../lib/vault/health-types";
import type { DiagramInfo, NoteMeta, Problem, VerifyReport } from "../../lib/vault/types";
import type { SaveState } from "../workspace/page/page-session";
import type { GroupId } from "../workspace/views/settings/index";

export type Level = "ok" | "info" | "warn" | "fail";
export type SectionId = "saving" | "backup" | "external" | "proposals" | "references" | "linked" | "meaning" | "capability";

/** Where an issue opens: a note, board, deck or diagram; the Review view; or a place in Settings. */
export type Goto = { path: string } | { view: "review" } | { settings: GroupId; row?: string };

/** A repair on offer. Each is an operation the app already has; the page shows what it would do before it does it. */
export type Repair =
  | { kind: "trash-copy"; copy: string; original: string | null }
  | { kind: "create-page"; title: string; project: string | null }
  | { kind: "redraw-picture"; diagram: string; title: string };

export interface Issue {
  id: string;
  text: string;
  /** Smaller words under the text, such as the path. */
  detail?: string;
  go?: Goto;
  repair?: Repair;
}

export interface Section {
  id: SectionId;
  title: string;
  level: Level;
  summary: string;
  issues: Issue[];
}

export interface HealthInput {
  health: Health;
  /** The save state of every page that has one, by path. */
  saves: Readonly<Record<string, SaveState>>;
  /** The last commit or push the core could not finish. */
  commitError: string | null;
  /** The last check's problems, when one was run in this window. */
  report: VerifyReport | null;
  diagrams: readonly DiagramInfo[];
  notes: readonly NoteMeta[];
  /** Whether the diagram editor is installed; null while that is not known. */
  editorInstalled: boolean | null;
  browser: { available: boolean; on: boolean };
  now?: number;
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

function saving({ health, saves, commitError }: HealthInput): Section {
  const failed = Object.keys(saves).find((path) => saves[path] === "failed");
  const writing = Object.values(saves).some((s) => s === "edited" || s === "saving");
  const { unindexed } = health.index;
  const { pending } = health.history;
  let level: Level = "ok";
  let summary = "All changes are saved.";
  if (failed !== undefined) {
    level = "fail";
    summary = `${failed} could not be saved. Your edits are still in the window.`;
  } else if (commitError) {
    level = "fail";
    summary = `History could not be updated: ${commitError}`;
  } else if (health.configProblem) {
    // The settings from before stay in force, so nothing is lost; the file needs a look.
    level = "warn";
    summary = `The vault's settings file could not be read, so the settings from before stay in force. ${health.configProblem}`;
  } else if (writing) {
    level = "info";
    summary = "Your latest edits are being written.";
  } else if (unindexed > 0) {
    level = "info";
    summary = `${plural(unindexed, "file is", "files are")} not in the search index yet.`;
  } else if (pending > 0) {
    level = "info";
    summary = `${plural(pending, "edit is", "edits are")} saved and waiting for ${pending === 1 ? "its" : "their"} history entry.`;
  }
  return { id: "saving", title: "Saving and indexing", level, summary, issues: [] };
}

function backup({ health, now }: HealthInput): Section {
  const when = (time: number | null) => (time ? relativeTime(time, now) : "never");
  const history = health.history.on ? "History is on." : "History is off. Turn it on in Settings to keep every version.";
  let level: Level = health.history.on ? "ok" : "info";
  let summary = history;
  const { backup: remote, backupFile: file } = health;
  if (remote.state === "failing") {
    level = "fail";
    summary = `${history} Backup is failing: ${remote.lastError ?? "pushing to the remote failed"}`;
  } else if (file?.state === "failing") {
    level = "fail";
    summary = `${history} The backup file is failing: ${file.lastError ?? "writing it failed"}`;
  } else if (remote.behind) {
    level = "warn";
    summary = `${history} Another computer backed up changes this one does not have. Get latest in Settings.`;
  } else if (remote.state === "unconfirmed") {
    level = "warn";
    summary = `${history} The vault names a backup that no one confirmed on this computer, so nothing is pushed yet.`;
  } else if (remote.state === "stale" || file?.state === "stale") {
    level = "warn";
    summary = `${history} The last backup was ${when(remote.lastPush ?? file?.lastWritten ?? null)}: over a day old.`;
  } else if (remote.state === "ok") {
    summary = `${history} Backed up ${when(remote.lastPush)}.`;
  } else if (file?.state === "ok") {
    summary = `${history} Backed up to a file ${when(file.lastWritten)}.`;
  } else if (health.history.on) {
    level = "info";
    summary = `${history} Backup is off: your notes have a history on this computer and no copy anywhere else.`;
  }
  const issues: Issue[] = level === "ok" ? [] : [{ id: "backup", text: "Backup and history settings", go: { settings: "history" } }];
  return { id: "backup", title: "History and backup", level, summary, issues };
}

/** `library/Plan (conflict 2026-10-11 09-30).md` was made from `library/Plan.md`. */
function originalOf(copy: string): string | null {
  const original = copy.replace(/ \(conflict [^)]*\)(?=(\.[^./]+)+$)/, "");
  return original === copy ? null : original;
}

function external({ health, notes }: HealthInput): Section {
  const issues: Issue[] = health.conflicts.map((copy) => {
    const original = originalOf(copy);
    const there = original !== null && notes.some((n) => n.path === original);
    return {
      id: `copy:${copy}`,
      text: copy,
      detail: there ? `A change outside KastenFlow met your edits. The page is ${original}.` : "A change outside KastenFlow met your edits. The page itself is not at its old place any more.",
      go: { path: copy },
      repair: { kind: "trash-copy", copy, original: there ? original : null },
    };
  });
  const n = issues.length;
  return {
    id: "external",
    title: "External changes",
    level: n > 0 ? "warn" : "ok",
    summary: n > 0 ? `${plural(n, "copy was", "copies were")} kept after files changed outside KastenFlow while you had edits.` : "No copies were kept after outside changes.",
    issues,
  };
}

function proposals({ health }: HealthInput): Section {
  const n = health.proposals;
  const issues: Issue[] = n > 0 ? [{ id: "proposals", text: "Review the proposed changes", go: { view: "review" } }] : [];
  return { id: "proposals", title: "Proposed changes", level: n > 0 ? "info" : "ok", summary: n > 0 ? `${plural(n, "change is", "changes are")} waiting for your review.` : "Nothing is waiting for review.", issues };
}

/** The file named by a link that points to no file, or the note it points to no note. */
const MISSING_NOTE = /^\[\[(.+?)\]\] points to no note$/;

function problemIssue(problem: Problem, index: number, notes: readonly NoteMeta[]): Issue {
  const id = `${problem.kind}:${problem.path ?? ""}:${index}`;
  const base: Issue = { id, text: problem.detail, ...(problem.path ? { detail: problem.path, go: { path: problem.path } } : { go: { settings: "history" } }) };
  if (problem.kind === "unresolved-link" && problem.path) {
    const title = MISSING_NOTE.exec(problem.detail)?.[1]?.split("#")[0]?.trim();
    if (title) return { ...base, repair: { kind: "create-page", title, project: notes.find((n) => n.path === problem.path)?.project ?? null } };
  }
  if (problem.kind === "diagram-picture" && problem.path) {
    const diagram = problem.path.replace(/\.svg$/, "");
    return { ...base, repair: { kind: "redraw-picture", diagram, title: diagram.replace(/^.*\//, "") } };
  }
  return base;
}

function references({ health, report, notes, now }: HealthInput): Section {
  if (report) {
    const n = report.problems.length;
    return {
      id: "references",
      title: "References and files",
      level: n > 0 ? "warn" : "ok",
      summary: n > 0 ? `${plural(n, "problem", "problems")} in ${plural(report.notes, "note", "notes")}.` : `All ${plural(report.notes, "note", "notes")} look fine.`,
      issues: report.problems.map((problem, i) => problemIssue(problem, i, notes)),
    };
  }
  const last = health.lastCheck;
  if (!last) return { id: "references", title: "References and files", level: "info", summary: "The vault is not checked yet. Check now looks for broken links, missing pictures and damaged history.", issues: [] };
  const n = last.problems;
  return {
    id: "references",
    title: "References and files",
    level: n > 0 ? "warn" : "ok",
    summary: n > 0 ? `${plural(n, "problem", "problems")} at the last check, ${relativeTime(last.time, now)}. Check now to see them.` : `No problems at the last check, ${relativeTime(last.time, now)}.`,
    issues: [],
  };
}

function linked({ diagrams }: HealthInput): Section {
  const issues: Issue[] = diagrams
    .filter((d) => d.preview !== "fresh" || d.problem)
    .map((d) => ({
      id: `picture:${d.path}`,
      text: `${d.title}: ${d.problem ? "cannot be read" : d.preview === "missing" ? "no picture yet" : d.preview === "draft" ? "the picture is a draft; the editor draws the exact one" : "the picture is out of date"}`,
      detail: d.problem ?? d.path,
      go: { path: d.path },
      ...(d.problem ? {} : { repair: { kind: "redraw-picture" as const, diagram: d.path, title: d.title } }),
    }));
  return {
    id: "linked",
    title: "Linked pictures",
    level: issues.length > 0 ? "warn" : "ok",
    summary: issues.length > 0 ? `${plural(issues.length, "diagram has", "diagrams have")} a picture that does not show the diagram as it is now. Pages and slides show the picture.` : "Every diagram's picture shows the diagram as it is now.",
    issues,
  };
}

function meaning({ health }: HealthInput): Section {
  const m = health.meaning;
  if (!m || !m.provider) return { id: "meaning", title: "Search by meaning", level: "info", summary: "Search by meaning is off. Searching still finds the words you type.", issues: [] };
  const covered = `${m.done} of ${m.total} notes have a vector${m.running ? " (running)" : ""}.`;
  return { id: "meaning", title: "Search by meaning", level: m.done < m.total ? "info" : "ok", summary: covered, issues: [] };
}

function capability({ editorInstalled, browser }: HealthInput): Section {
  const issues: Issue[] = [];
  if (editorInstalled === false) issues.push({ id: "editor", text: "The diagram editor is not installed. Diagrams show as pictures; drawing and editing need it.", go: { settings: "diagrams", row: "diagrams.editor" } });
  if (browser.available && !browser.on) issues.push({ id: "browser", text: "The browser is off. Slides cannot show a web page beside them until it is turned on.", go: { settings: "browser", row: "browser.enabled" } });
  const editor = editorInstalled === null ? "Diagram editor: not known yet" : editorInstalled ? "Diagram editor: installed" : "Diagram editor: not installed";
  const web = !browser.available ? "Web browser: needs the desktop app" : browser.on ? "Web browser: on" : "Web browser: off";
  return { id: "capability", title: "Drawing and the browser", level: issues.length > 0 ? "info" : "ok", summary: `${editor}. ${web}.`, issues };
}

/** The sections of the health page, in the order the page shows them. */
export function sectionsOf(input: HealthInput): Section[] {
  return [saving(input), backup(input), external(input), proposals(input), references(input), linked(input), meaning(input), capability(input)];
}
