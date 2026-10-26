// Projects: each project's state, summaries and setups as the Projects hub
// shows them (the shapes of kasten-core's projects and setups ops, serde
// camelCase) and the calls the app makes.

import type { DraftRule } from "./draft-rule";
import type { NoteFile } from "./types";

/** What a project is doing. A project page with no `status` is Active. */
export type ProjectStatus = "Active" | "Paused" | "Done";
/** How a project is going; optional, and independent of its status. */
export type ProjectHealth = "On track" | "At risk" | "Blocked";

/** The values the core accepts, in the order a menu lists them. */
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["Active", "Paused", "Done"];
export const PROJECT_HEALTHS: readonly ProjectHealth[] = ["On track", "At risk", "Blocked"];

/** A change to a project page's state. A key left out stays as it is; `null`
 * removes it. All of them are checked before anything is written, and they
 * are one commit. */
export interface ProjectStateChange {
  status?: ProjectStatus | null;
  health?: ProjectHealth | null;
  /** The to-do the project does next: the path, id or title of a `task` note
   * (the page keeps its id). */
  nextAction?: string | null;
  /** The day the project was last reviewed, `YYYY-MM-DD`. */
  reviewed?: string | null;
  /** The day the next review is due, `YYYY-MM-DD`. */
  reviewAfter?: string | null;
}

/** How many of something are open, done and (of the open ones) past their day. */
export interface TaskCounts {
  open: number;
  done: number;
  overdue: number;
}

/** The task note a project does next. */
export interface NextAction {
  id: string;
  path: string;
  title: string;
  /** The task is done (its `status` says Done). */
  done: boolean;
}

/** One project, worked out from the index in a single pass. */
export interface ProjectSummary {
  /** The project page, `projects/<folder>/_project.md`. */
  path: string;
  /** The folder under `projects/`: the project's name in `NoteMeta.project`. */
  folder: string;
  id: string | null;
  title: string;
  icon: string | null;
  /** The page's one-line `summary` property. */
  summary: string | null;
  /** `archived: true` on the page. */
  archived: boolean;
  /** `Other`: the page names a status the app does not know. */
  status: ProjectStatus | "Other";
  health: ProjectHealth | "Other" | null;
  nextAction: NextAction | null;
  lastReview: string | null;
  reviewAfter: string | null;
  /** The review is due: a day was set and it has come, for a project that is
   * neither Done nor archived. */
  reviewDue: boolean;
  /** `#task` notes in the project, by their `status` and `due`. */
  tasks: TaskCounts;
  /** To-do lines (`- [ ]`) in the project's notes, by their day. */
  checklist: TaskCounts;
  /** The newest thing in the project, notes, boards and decks alike. */
  latest: { modified: number; path: string; title: string; kind: string } | null;
  /** The newest note tagged `project-update`; `date` is its `date` property. */
  lastUpdate: { path: string; title: string; date: string | null } | null;
  /** Notes in the project, its page, templates and files other than notes left out. */
  notes: number;
  boards: number;
  decks: number;
}

/** A way of starting a project: a few pages, a whiteboard, sometimes a deck. */
export interface SetupInfo {
  id: string;
  /** An emoji. */
  icon: string;
  name: string;
  summary: string;
  /** Where its files go, relative to the project folder. */
  files: string[];
  /** The tags it brings schemas for, kept if the vault has them. */
  tags: string[];
  /** One the person saved from a project, which they can rename and delete. */
  saved?: boolean;
}

/** One page of a project that a saved setup could keep. */
export interface SetupPage {
  /** The page's vault path. */
  path: string;
  title: string;
  /** Ticked to start with: a page directly under the project's `pages/` folder. */
  included: boolean;
}

/** What a project has that a setup could keep: the dialog's checklist. */
export interface SetupSource {
  /** The project's folder under `projects/`. */
  folder: string;
  title: string;
  pages: SetupPage[];
  /** The tags whose schemas (and views) come along. */
  tags: string[];
  /** The names of the default properties that come along. */
  props: string[];
}

/** A setup that was just saved. */
export interface SavedSetup {
  /** What New project calls it, `saved:<slug>`. */
  id: string;
  slug: string;
  name: string;
  written: string[];
  /** The commit, for Undo; none in a vault without history. */
  commit: string | null;
}

/** A saved setup that was moved to the trash. */
export interface SetupGone {
  id: string;
  trashed: string;
  /** The commit, for Undo. */
  commit: string | null;
}

/** Where a setup goes: a new project, or the folder of one that exists. */
export type SetupTarget = { kind: "new"; title: string } | { kind: "existing"; folder: string };

/** What applying a setup would do, worked out without writing anything. */
export interface SetupPlan {
  /** The project page, which is made when the target is new. */
  projectPath: string;
  /** The page to open once it is applied. */
  home: string;
  /** Vault paths it would write. */
  create: string[];
  /** Vault paths that exist and stay as they are. */
  keep: string[];
  /** Properties it would add to the project page. */
  props: string[];
}

/** What applying a setup did. */
export interface AppliedSetup {
  projectPath: string;
  /** The page to open. */
  home: string;
  /** Vault paths it wrote, the project page included when it made or changed it. */
  written: string[];
  kept: string[];
  /** The one commit it made, for Undo; none in a vault without history. */
  commit: string | null;
}

export interface ProjectOps {
  /** Changes a project page's status, health, next action and review days in one commit. */
  setProjectState(path: string, change: ProjectStateChange): Promise<NoteFile>;
  /** Every project (archived ones too), by title, with its counts. `today` is the person's day, `YYYY-MM-DD`; it decides what is overdue and due. */
  projectSummaries(today?: string): Promise<ProjectSummary[]>;
  /** The setups on offer. */
  listSetups(): Promise<SetupInfo[]>;
  /** What applying a setup would write and keep. */
  previewSetup(id: string, target: SetupTarget): Promise<SetupPlan>;
  /** Adds a setup's files in one commit that Undo takes back; never replaces a file. */
  applySetup(id: string, target: SetupTarget): Promise<AppliedSetup>;
  /** What the project has that a setup could keep: its pages (the ones directly under `pages/` ticked), tags and properties. `project` is its folder. */
  previewProjectSetup(project: string): Promise<SetupSource>;
  /** Saves the project as a setup new projects can start from: the pages in `pages` (vault paths), its tags' schemas and default properties, in one commit that Undo takes back. A blank `slug` makes the file name of the title. */
  saveProjectSetup(project: string, title: string, pages: string[], slug?: string): Promise<SavedSetup>;
  /** Gives a saved setup another name. */
  renameSetup(id: string, name: string): Promise<SetupInfo>;
  /** Moves a saved setup to the trash (nothing is deleted for good); one commit that Undo takes back. */
  trashSetup(id: string): Promise<SetupGone>;
}

/** What a call about a draft does, for each call of `ProjectOps`. */
export const PROJECT_RULES = {
  setProjectState: "pass",
  projectSummaries: "pass",
  listSetups: "pass",
  previewSetup: "pass",
  applySetup: "pass",
  previewProjectSetup: "pass",
  saveProjectSetup: "pass",
  renameSetup: "pass",
  trashSetup: "pass",
} as const satisfies Record<keyof ProjectOps, DraftRule>;
