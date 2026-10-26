// How this window shows things: theme, page font and width, favourites,
// and how the Projects list is arranged. Preferences, not content, so they
// live in the browser's storage.

import { create } from "zustand";

import { applyMotion, MOTION_PREFS, type MotionPref } from "../../lib/motion";
import { clampKeep, KEEP_DEFAULT } from "../../shell/keep-alive";
import { isOpens, type Opens } from "./opens";
import { readSets, type TabSet } from "./tab-sets";
import { ACCENTS, applyAccent, applyTheme, loadTheme, type Accent, type ThemePref } from "./theme";

export type PageFont = "default" | "serif" | "mono";

/** How wide page text runs: the usual column, a wider one (60rem), or the whole pane. */
export type PageWidth = "normal" | "wide" | "full";
export const PAGE_WIDTHS: readonly PageWidth[] = ["normal", "wide", "full"];

/** The size of page text: 14, 16, 18 or 20 pixels. */
export type TextSize = "small" | "normal" | "large" | "xl";
export const TEXT_SIZES: readonly TextSize[] = ["small", "normal", "large", "xl"];

interface Stored {
  font: PageFont;
  /** The size of page text, for every page that does not set its own. */
  textSize: TextSize;
  /** The width of page text, for every page that does not set its own. */
  pageWidth: PageWidth;
  spellcheck: boolean;
  /** The accent colour of buttons, selection and focus. */
  accent: Accent;
  /** Paths of favourite notes, in the order they were added. */
  favourites: string[];
  /** Project folders in the order the person arranged them. */
  projectOrder: string[];
  /** Project folders pinned to the top of the Projects list. */
  pinnedProjects: string[];
  /** The journal shows its list of days beside the page. */
  journalDays: boolean;
  /** Where a page picked in a calendar, table or board opens (Notion's peeks). */
  peekMode: PeekMode;
  /** A click on a page opens it in its own tab, keeping the one you are on. */
  newTabs: boolean;
  /** Home's sections in order, as Customize left them; null for the usual. */
  homeSections: string[] | null;
  /** Home's recent list: the kind of thing it shows ("all", "page", "board"...), the project it is narrowed to (null for every one), and how it is laid out. */
  homeFilter: string;
  homeProject: string | null;
  homeLayout: HomeLayout;
  /** Tabs saved together under a name, to open again. */
  tabSets: TabSet[];
  /** What the Calendar shows on its days. */
  calendarShow: CalendarShow;
  /** The day weeks start on: 1 Monday, 0 Sunday, 6 Saturday. */
  weekStart: WeekStart;
  /** The sidebar's width in pixels, as its edge was dragged. */
  sidebarWidth: number;
  /** Whether menus, dialogs and views move as they open. */
  motion: MotionPref;
  /** Sidebar sections folded away, by title. */
  foldedSections: string[];
  /** Where a plain click on a link or sub-page opens, unless the page says otherwise. */
  pageLinksOpen: Opens;
  /** "Open to the right" puts the page in the tab already there (true) or adds a tab. */
  rightReplaces: boolean;
  /** The "+" on the tab strip makes new tabs in the pane to the right. */
  plusOpensRight: boolean;
  /** Quick notes and captures show under their project in the sidebar. */
  sidebarShowCards: boolean;
  /** Pages pinned to the top of their project in the sidebar. */
  pinnedPages: string[];
  /** The views pinned to the sidebar, in order, by their ids; null for the usual ones. */
  navPinned: string[] | null;
  /** The sidebar's "More views" list is open. */
  moreViews: boolean;
  /** Whether a page's properties show under its title: always, folded, or folded when there are more than five. */
  propsFold: PropsFold;
  /** Pages whose properties were folded (true) or unfolded (false) by hand, by note id. */
  propsFolded: Record<string, boolean>;
  /** How many other recent tabs of a pane stay ready (hidden, with their state): 0 to 8, 0 is off. */
  keepTabs: number;
  /** The rows a table view shows open with their sub-items, by view (`tag|view`), as row ids. */
  subItemsOpen: Record<string, string[]>;
}

export type PropsFold = "shown" | "folded" | "auto";
export const PROPS_FOLDS: readonly PropsFold[] = ["shown", "folded", "auto"];

const foldChoices = (value: unknown): Record<string, boolean> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((e): e is [string, boolean] => typeof e[1] === "boolean"))
    : {};

const openRows = (value: unknown): Record<string, string[]> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((e): e is [string, string[]] => Array.isArray(e[1])).map(([k, v]) => [k, v.filter((id): id is string => typeof id === "string")]))
    : {};

/** The sidebar's usual width and its limits. */
export const SIDEBAR_WIDTH = { initial: 240, min: 200, max: 440 };

const sidebarWidth = (value: unknown): number =>
  typeof value === "number" && value >= SIDEBAR_WIDTH.min && value <= SIDEBAR_WIDTH.max ? Math.round(value) : SIDEBAR_WIDTH.initial;

/** What the Calendar shows: journal days, notes by their date properties,
 * dated to-dos, notes that mention a day, and notes made on a day. */
/** The day weeks start on: 1 Monday, 0 Sunday, 6 Saturday. */
export type WeekStart = 0 | 1 | 6;
export const WEEK_STARTS: readonly WeekStart[] = [1, 0, 6];

export interface CalendarShow {
  journal: boolean;
  dated: boolean;
  tasks: boolean;
  mentions: boolean;
  made: boolean;
}

export const CALENDAR_SHOW: CalendarShow = { journal: true, dated: true, tasks: true, mentions: true, made: false };

function readShow(value: unknown): CalendarShow {
  const saved = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof CalendarShow, unknown>>;
  const pick = (key: keyof CalendarShow) => (typeof saved[key] === "boolean" ? (saved[key] as boolean) : CALENDAR_SHOW[key]);
  return { journal: pick("journal"), dated: pick("dated"), tasks: pick("tasks"), mentions: pick("mentions"), made: pick("made") };
}

export type PeekMode = "center" | "side" | "full";
const PEEKS: readonly PeekMode[] = ["center", "side", "full"];

/** Home's recent list as rows, or as a denser grid of two columns. */
export type HomeLayout = "list" | "grid";

interface PrefsState extends Stored {
  theme: ThemePref;
  setTheme(theme: ThemePref): void;
  set(patch: Partial<Stored>): void;
  toggleFavourite(path: string): void;
  /** Keeps favourites and pinned pages pointing at a note that moved or went away. */
  moveFavourite(from: string, to: string | null): void;
  /** Pins a page to the top of its project in the sidebar, or unpins it. */
  togglePinnedPage(path: string): void;
  /** Pins a project folder to the top of the list, or unpins it. */
  togglePinnedProject(project: string): void;
}

const KEY = "kasten.prefs";
const DEFAULTS: Stored = { font: "default", textSize: "normal", pageWidth: "normal", spellcheck: true, accent: "blue", favourites: [], projectOrder: [], pinnedProjects: [], journalDays: true, peekMode: "center", newTabs: false, homeSections: null, homeFilter: "all", homeProject: null, homeLayout: "list", tabSets: [], calendarShow: CALENDAR_SHOW, weekStart: 1, sidebarWidth: SIDEBAR_WIDTH.initial, motion: "system", foldedSections: [], pageLinksOpen: "here", rightReplaces: true, plusOpensRight: false, sidebarShowCards: false, pinnedPages: [], navPinned: null, moreViews: false, propsFold: "auto", propsFolded: {}, keepTabs: KEEP_DEFAULT, subItemsOpen: {} };

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function load(): Stored {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored> & { smallText?: unknown; fullWidth?: unknown };
    const accent = ACCENTS.includes(saved.accent as Accent) ? (saved.accent as Accent) : "blue";
    // Before there were four sizes there was one switch, "Small text".
    const textSize = TEXT_SIZES.includes(saved.textSize as TextSize) ? (saved.textSize as TextSize) : saved.smallText === true ? "small" : "normal";
    delete saved.smallText;
    // Before there were three widths there was one switch, "Full width".
    const pageWidth = PAGE_WIDTHS.includes(saved.pageWidth as PageWidth) ? (saved.pageWidth as PageWidth) : saved.fullWidth === true ? "full" : "normal";
    delete saved.fullWidth;
    return {
      ...DEFAULTS,
      ...saved,
      accent,
      textSize,
      pageWidth,
      favourites: Array.isArray(saved.favourites) ? saved.favourites : [],
      projectOrder: names(saved.projectOrder),
      pinnedProjects: names(saved.pinnedProjects),
      journalDays: saved.journalDays !== false,
      peekMode: PEEKS.includes(saved.peekMode as PeekMode) ? (saved.peekMode as PeekMode) : "center",
      newTabs: saved.newTabs === true,
      homeSections: Array.isArray(saved.homeSections) ? names(saved.homeSections) : null,
      homeFilter: typeof saved.homeFilter === "string" ? saved.homeFilter : "all",
      homeProject: typeof saved.homeProject === "string" ? saved.homeProject : null,
      homeLayout: saved.homeLayout === "grid" ? "grid" : "list",
      tabSets: readSets(saved.tabSets),
      calendarShow: readShow(saved.calendarShow),
      weekStart: WEEK_STARTS.includes(saved.weekStart as WeekStart) ? (saved.weekStart as WeekStart) : 1,
      sidebarWidth: sidebarWidth(saved.sidebarWidth),
      motion: MOTION_PREFS.includes(saved.motion as MotionPref) ? (saved.motion as MotionPref) : "system",
      foldedSections: names(saved.foldedSections),
      pageLinksOpen: isOpens(saved.pageLinksOpen) ? saved.pageLinksOpen : "here",
      rightReplaces: saved.rightReplaces !== false,
      plusOpensRight: saved.plusOpensRight === true,
      sidebarShowCards: saved.sidebarShowCards === true,
      pinnedPages: names(saved.pinnedPages),
      navPinned: Array.isArray(saved.navPinned) ? names(saved.navPinned) : null,
      moreViews: saved.moreViews === true,
      keepTabs: clampKeep(saved.keepTabs),
      propsFold: PROPS_FOLDS.includes(saved.propsFold as PropsFold) ? (saved.propsFold as PropsFold) : "auto",
      propsFolded: foldChoices(saved.propsFolded),
      subItemsOpen: openRows(saved.subItemsOpen),
    };
  } catch {
    return DEFAULTS;
  }
}

function save(state: Stored): void {
  const { font, textSize, pageWidth, spellcheck, accent, favourites, projectOrder, pinnedProjects, journalDays, peekMode, newTabs, homeSections, homeFilter, homeProject, homeLayout, tabSets, calendarShow, weekStart, sidebarWidth, motion, foldedSections, pageLinksOpen, rightReplaces, plusOpensRight, sidebarShowCards, pinnedPages, navPinned, moreViews, propsFold, propsFolded, keepTabs, subItemsOpen } = state;
  try {
    localStorage.setItem(KEY, JSON.stringify({ font, textSize, pageWidth, spellcheck, accent, favourites, projectOrder, pinnedProjects, journalDays, peekMode, newTabs, homeSections, homeFilter, homeProject, homeLayout, tabSets, calendarShow, weekStart, sidebarWidth, motion, foldedSections, pageLinksOpen, rightReplaces, plusOpensRight, sidebarShowCards, pinnedPages, navPinned, moreViews, propsFold, propsFolded, keepTabs, subItemsOpen }));
  } catch {
    // Preferences fall back to their defaults next time.
  }
}

export const usePrefs = create<PrefsState>()((set, get) => {
  const update = (patch: Partial<Stored>) => {
    set(patch);
    if (patch.accent) applyAccent(patch.accent);
    if (patch.motion) applyMotion(patch.motion);
    if (patch.keepTabs !== undefined) set({ keepTabs: clampKeep(patch.keepTabs) });
    save(get());
  };
  return {
    ...load(),
    theme: loadTheme(),
    setTheme(theme) {
      applyTheme(theme);
      set({ theme });
    },
    set: update,
    toggleFavourite(path) {
      const { favourites } = get();
      update({ favourites: favourites.includes(path) ? favourites.filter((p) => p !== path) : [...favourites, path] });
    },
    moveFavourite(from, to) {
      const { favourites, pinnedPages } = get();
      const follow = (list: string[]) => (to ? list.map((p) => (p === from ? to : p)) : list.filter((p) => p !== from));
      // Pinned pages follow a page the way favourites do.
      const patch: Partial<Stored> = {};
      if (favourites.includes(from)) patch.favourites = follow(favourites);
      if (pinnedPages.includes(from)) patch.pinnedPages = follow(pinnedPages);
      if (patch.favourites || patch.pinnedPages) update(patch);
    },
    togglePinnedPage(path) {
      const { pinnedPages } = get();
      update({ pinnedPages: pinnedPages.includes(path) ? pinnedPages.filter((p) => p !== path) : [...pinnedPages, path] });
    },
    togglePinnedProject(project) {
      const { pinnedProjects } = get();
      update({ pinnedProjects: pinnedProjects.includes(project) ? pinnedProjects.filter((p) => p !== project) : [...pinnedProjects, project] });
    },
  };
});
