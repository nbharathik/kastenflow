// The state of the Settings window: which group is open, what is searched
// for, which navigation headings are folded, and the row marked after a jump.
// The group and the folds are remembered in this browser, as conveniences.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { inTauri } from "../../../../lib/api";
import { entryById, GROUPS, HEADINGS, rowDomId, searchSettings, type Found, type GroupId, type NavHeading, type SettingsTarget } from "./index";
import { useSettingsJump } from "./jump";
import { wordsOf } from "./search";

const KEY = "kasten.settings";
const FIRST: GroupId = "appearance";
/** How long a row stays marked after a jump. */
const FLASH_MS = 1600;

interface Kept {
  group: GroupId;
  folded: NavHeading[];
}

const isGroup = (id: unknown): id is GroupId => GROUPS.some((g) => g.id === id);

function kept(): Kept {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { group?: unknown; folded?: unknown };
    const folded = Array.isArray(saved.folded) ? saved.folded.filter((h): h is NavHeading => HEADINGS.includes(h as NavHeading)) : [];
    return { group: isGroup(saved.group) ? saved.group : FIRST, folded };
  } catch {
    return { group: FIRST, folded: [] };
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
  const found = useMemo(() => (words.length > 0 ? searchSettings(query, desktop) : null), [words, query, desktop]);

  const show = useCallback((next: GroupId) => {
    setGroup(next);
    keep({ group: next });
    main.current?.scrollTo?.({ top: 0 });
  }, []);

  const pick = useCallback(
    (next: GroupId) => {
      setQuery("");
      show(next);
    },
    [show],
  );

  const open = useCallback(
    (id: string) => {
      const entry = entryById(id);
      if (!entry) return;
      pick(entry.group);
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
