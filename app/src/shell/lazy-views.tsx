// Views that are not on the first screen load when first opened, and in
// idle time once the vault is open, one at a time, so the window starts
// with less code to parse, stays quick while the rest loads, and opening a
// view later is still instant.

import { lazy } from "react";

const calendar = () => import("../features/calendar/CalendarView");
const chat = () => import("../features/chat/ChatView");
const library = () => import("../features/library/LibraryView");
const review = () => import("../features/review/Review");
const history = () => import("../features/review/History");
const settings = () => import("../features/workspace/views/settings/Settings");
const tagsHome = () => import("../features/tags/TagsHome");
const tagDatabase = () => import("../features/tags/TagDatabase");
const boardsHome = () => import("../features/boards/BoardsHome");
const slidesHome = () => import("../features/slides/SlidesHome");
const diagramsHome = () => import("../features/diagrams/DiagramsHome");
const diagramView = () => import("../features/diagrams/DiagramView");
const tasks = () => import("../features/tasks/TasksView");
const trash = () => import("../features/workspace/views/Trash");
const reader = () => import("../features/sources/reader/PdfReader");
const highlights = () => import("../features/sources/HighlightsHome");
const importView = () => import("../features/import/ImportView");
const graph = () => import("../features/graph/GraphView");
const projectOverview = () => import("../features/projects/overview/ProjectOverview");
const browser = () => import("../features/browser/BrowserView");
/** A project page's home; the page loads it itself, this only fetches it early. */
const projectHome = () => import("../features/projects/ProjectHome");

export const CalendarView = lazy(() => calendar().then((m) => ({ default: m.CalendarView })));
export const ChatView = lazy(() => chat().then((m) => ({ default: m.ChatView })));
export const LibraryView = lazy(() => library().then((m) => ({ default: m.LibraryView })));
export const Review = lazy(() => review().then((m) => ({ default: m.Review })));
export const History = lazy(() => history().then((m) => ({ default: m.History })));
export const Settings = lazy(() => settings().then((m) => ({ default: m.Settings })));
export const TagsHome = lazy(() => tagsHome().then((m) => ({ default: m.TagsHome })));
export const TagDatabase = lazy(() => tagDatabase().then((m) => ({ default: m.TagDatabase })));
export const BoardsHome = lazy(() => boardsHome().then((m) => ({ default: m.BoardsHome })));
export const SlidesHome = lazy(() => slidesHome().then((m) => ({ default: m.SlidesHome })));
/** The Diagrams view, and a diagram open in a tab (the editor's frame loads with it). */
export const DiagramsHome = lazy(() => diagramsHome().then((m) => ({ default: m.DiagramsHome })));
export const DiagramView = lazy(() => diagramView().then((m) => ({ default: m.DiagramView })));
export const Tasks = lazy(() => tasks().then((m) => ({ default: m.Tasks })));
export const Trash = lazy(() => trash().then((m) => ({ default: m.Trash })));
/** The PDF reader brings pdf.js, whose own code loads with the first PDF. */
export const PdfReader = lazy(reader);
export const HighlightsHome = lazy(() => highlights().then((m) => ({ default: m.HighlightsHome })));
export const ImportView = lazy(() => importView().then((m) => ({ default: m.ImportView })));
export const GraphView = lazy(() => graph().then((m) => ({ default: m.GraphView })));
/** The full-screen project overview, with its tabs and saved tables. */
export const ProjectOverview = lazy(() => projectOverview().then((m) => ({ default: m.ProjectOverview })));
/** The browser tab: a native web view over a placeholder, with its bar and capture. */
export const BrowserView = lazy(() => browser().then((m) => ({ default: m.BrowserView })));

/** The views preloaded, most used first. */
const PRELOADED = [projectHome, library, tasks, calendar, boardsHome, tagsHome, tagDatabase, chat, highlights, settings, history, review, trash];

/** Fetches the lazy views' code in idle time, one view per idle spell.
 * Development builds skip it: Vite compiles each file when it is asked
 * for, and every view at once would slow the start. */
export function preloadViews(views: readonly (() => Promise<unknown>)[] = PRELOADED, whenIdle: (run: () => void) => void = idle): void {
  if (import.meta.env.MODE === "test" && views === PRELOADED) return;
  if (import.meta.env.DEV && views === PRELOADED) return;
  const queue = [...views];
  const next = () => {
    const view = queue.shift();
    if (view) void view().catch(() => {}).finally(() => whenIdle(next));
  };
  whenIdle(next);
}

function idle(run: () => void): void {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 200);
}
