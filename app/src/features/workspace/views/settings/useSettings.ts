// The state of the Settings window: which group is open, what is searched
// for, which navigation headings are folded, and the row marked after a jump.
// The group, the folds and where each group was scrolled to are remembered in
// this browser, as conveniences.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { inTauri } from "../../../../lib/api";
import { commandOfRow, withCommands } from "./command-search";
import { entryById, GROUPS, HEADINGS, rowDomId, searchSettings, type Found, type GroupId, type NavHeading, type SettingsTarget } from "./index";
import { useSettingsJump } from "./jump";
import { wordsOf } from "./search";

const KEY = "kasten.settings";
const FIRST: GroupId = "appearance";
/** How long a row stays marked after a jump. */
const FLASH_MS = 1600;
/** How long after the last scroll the position is written down. */
const SCROLL_MS = 120;

type Scrolls = Partial<Record<GroupId, number>>;

interface Kept {
  group: GroupId;
  folded: NavHeading[];
  /** Pixels scrolled in each group, as it was left. */
  scroll: Scrolls;
}

const isGroup = (id: unknown): id is GroupId => GROUPS.some((g) => g.id === id);

function scrollsOf(saved: unknown): Scrolls {
  const out: Scrolls = {};
  if (typeof saved !== "object" || saved === null) return out;
  for (const [id, top] of Object.entries(saved)) if (isGroup(id) && typeof top === "number" && Number.isFinite(top) && top >= 0) out[id] = top;
  return out;
}

function kept(): Kept {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { group?: unknown; folded?: unknown; scroll?: unknown };
    const folded = Array.isArray(saved.folded) ? saved.folded.filter((h): h is NavHeading => HEADINGS.includes(h as NavHeading)) : [];
    return { group: isGroup(saved.group) ? saved.group : FIRST, folded, scroll: scrollsOf(saved.scroll) };
  } catch {
    return { group: FIRST, folded: [], scroll: {} };
  }
}

function keep(patch: Partial<Kept>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...kept(), ...patch }));
  } catch {
    // The window opens at Appearance next time.
  }
}

export interface SettingsState {
  group: GroupId;
  query: string;
  words: string[];
  /** What the search found; null when nothing is searched for. */
  found: Found | null;
  flash: string | null;
  folded: readonly NavHeading[];
  search: RefObject<HTMLInputElement | null>;
  main: RefObject<HTMLDivElement | null>;
  setQuery(query: string): void;
  /** Opens a group's page (ending any search). */
  pick(group: GroupId): void;
  /** Opens the group of a setting, scrolled to its row. */
  open(id: string): void;
  fold(heading: NavHeading): void;
  focusSearch(): void;
}

export function useSettings(): SettingsState {
  const [group, setGroup] = useState<GroupId>(() => kept().group);
  const [folded, setFolded] = useState<NavHeading[]>(() => kept().folded);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const desktop = inTauri();

  const words = useMemo(() => wordsOf(query), [query]);
  // The settings the words find, and the shortcut commands whose names they find.
  const found = useMemo(() => (words.length > 0 ? withCommands(searchSettings(query, desktop), words) : null), [words, query, desktop]);

  // Where the group on show was scrolled to, written down a moment after the last scroll
  // (and when the window goes). The position is read as it happens: a window that is going
  // away has no scroll position left to read.
  const shown = useRef(group);
  const searching = useRef(false);
  const latest = useRef<number | null>(null);
  useEffect(() => {
    shown.current = group;
    searching.current = found !== null;
  }, [group, found]);
  const flushScroll = useCallback(() => {
    const top = latest.current;
    latest.current = null;
    if (top === null || searching.current) return;
    keep({ scroll: { ...kept().scroll, [shown.current]: Math.round(top) } });
  }, []);
  useEffect(() => {
    const element = main.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      latest.current = element.scrollTop;
      clearTimeout(timer);
      timer = setTimeout(flushScroll, SCROLL_MS);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      flushScroll();
    };
  }, [flushScroll]);
  // A group opens where it was left (the top when it was never scrolled); results scroll as they are.
  const searched = found !== null;
  useLayoutEffect(() => {
    if (!searched && main.current) main.current.scrollTop = kept().scroll[group] ?? 0;
  }, [group, searched]);

  const show = useCallback(
    (next: GroupId) => {
      flushScroll();
      // Asked again for the group already open: back to its top, as a link to it always did.
      if (next === shown.current) main.current?.scrollTo?.({ top: 0 });
      setGroup(next);
      keep({ group: next });
    },
    [flushScroll],
  );

  const pick = useCallback(
    (next: GroupId) => {
      setQuery("");
      show(next);
    },
    [show],
  );

  const open = useCallback(
    (id: string) => {
      // A setting's row, or a shortcut command's row in the key editor.
      const group = entryById(id)?.group ?? (commandOfRow(id) ? "shortcuts" : undefined);
      if (!group) return;
      pick(group);
      setFlash(id);
    },
    [pick],
  );

  // A row is scrolled into view once its group is drawn, and marked for a moment.
  useEffect(() => {
    if (!flash) return;
    const frame = requestAnimationFrame(() => document.getElementById(rowDomId(flash))?.scrollIntoView?.({ block: "start" }));
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [flash]);

  const focusSearch = useCallback(() => {
    search.current?.focus();
    search.current?.select();
  }, []);

  const apply = useCallback(
    (to: SettingsTarget) => {
      if (to.search !== undefined) setQuery(to.search);
      else if (to.group || to.row) setQuery("");
      if (to.group) show(to.group);
      if (to.row) setFlash(to.row);
      if (to.focusSearch) requestAnimationFrame(focusSearch);
    },
    [show, focusSearch],
  );

  // Opened at a group, a row or a search, by the palette or a link.
  const target = useSettingsJump((s) => s.target);
  useEffect(() => {
    if (!target) return;
    useSettingsJump.setState({ target: null });
    apply(target);
  }, [target, apply]);

  const fold = useCallback((heading: NavHeading) => {
    setFolded((was) => {
      const next = was.includes(heading) ? was.filter((h) => h !== heading) : [...was, heading];
      keep({ folded: next });
      return next;
    });
  }, []);

  return { group, query, words, found, flash, folded, search, main, setQuery, pick, open, fold, focusSearch };
}
