import "./overlays.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isDay } from "../../../lib/dates";
import { useShell } from "../../../lib/store";
import type { BoardInfo, Hit, NoteMeta, SourceInfo } from "../../../lib/vault/types";
import { projectTitle, useBoards } from "../../boards/store";
import { iconOf, readable, titleOf } from "../names";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { lineIcon } from "../../../ui/glyph";
import { Modal } from "../../../ui/Modal";
import { isArchived } from "../project-order";
import { whereIfShared } from "../where";
import { howFrom, useWorkspace, type OpenHow } from "../store";
import { newCollectionFromQuery } from "../../collections/requests";
import { searchLibrary } from "../../library/request";
import { tagPlace } from "../../tags/place";
import { findByTitle, noteAt, tagCounts } from "../tree";
import { useSources } from "../../sources/store";
import { openAt, searchedWords } from "../page/jump";
import { openSettingsAt } from "../views/settings/jump";
import { usePluginsVersion } from "../../../plugins/registry";
import { allCommands } from "./commands";
import { keepSearch, pdfRows, recentSearches, settingsRows, type Row } from "./palette-rows";
import { byModified, matchTitles, score, searchKeys } from "./match";
import { editorKeys } from "../../shortcuts/catalog";
import { keyLabel, useKeys } from "../../shortcuts/store";
import { meaningApi, type MeaningApi, type NearNote } from "../../meaning/client";

/** Notes found by meaning for a query, while they are asked for, or why not. */
interface ByMeaning {
  query: string;
  found: NearNote[] | null;
  error: string | null;
}

export { score } from "./match";

/** Ctrl+K: open any page, search every word, or run a command. */
export function Palette({ meaning = meaningApi }: { meaning?: MeaningApi }) {
  const setPalette = useShell((s) => s.setPalette);
  const [byMeaning, setByMeaning] = useState<ByMeaning | null>(null);
  const notes = useWorkspace((s) => s.notes);
  const recent = useWorkspace((s) => s.recent);
  const client = useWorkspace((s) => s.client);
  const [query, setQuery] = useState(() => useShell.getState().paletteQuery);
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => setPalette(false);

  useEffect(() => {
    const q = query.trim();
    if (!client || q.length < 2) return setHits([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      client.search(q, 12).then(
        (found) => !cancelled && setHits(found),
        () => {},
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);

  // PDFs are listed once they are known.
  useEffect(() => {
    if (useSources.getState().list === null) void useSources.getState().loadList().catch(() => {});
  }, []);

  // Title keys for every note are made once per list: make them while the
  // palette opens rather than on the first keystroke.
  useEffect(() => {
    const warm = () => void searchKeys(notes);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(warm, { timeout: 150 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 0);
    return () => clearTimeout(id);
  }, [notes]);

  const boards = useBoards((s) => s.list);
  const sources = useSources((s) => s.list);
  // Read once as the palette opens; a search run now shows next time.
  const [searches] = useState(recentSearches);
  const ask = useCallback(
    (q: string) => {
      setByMeaning({ query: q, found: null, error: null });
      setSelected(0);
      meaning.search(q, 12).then(
        (found) => setByMeaning((m) => (m?.query === q ? { ...m, found } : m)),
        (err: unknown) => setByMeaning((m) => (m?.query === q ? { ...m, error: err instanceof Error ? err.message : String(err) } : m)),
      );
    },
    [meaning],
  );
  // Commands of a plugin turned on or off while the palette is open.
  const plugins = usePluginsVersion();
  const rows = useMemo(() => {
    if (byMeaning) return meaningRows(byMeaning);
    const q = query.trim();
    const found = buildRows(notes, boards, recent, hits, query, sources);
    if (!q && searches.length > 0) {
      const again = searches.slice(0, 3).map((text): Row => ({ key: `again:${text}`, icon: lineIcon("search"), label: text, detail: "Recent search", stay: true, run: () => setQuery(text) }));
      const pages = found.filter((r) => !r.key.startsWith("cmd:"));
      return [...pages, ...again, ...found.filter((r) => r.key.startsWith("cmd:"))];
    }
    if (!meaning.available() || q.length < 3 || q.startsWith("#")) return found;
    const row: Row = { key: "meaning", icon: lineIcon("sparkle"), label: `Find notes about “${q}” by meaning`, stay: true, run: () => ask(q) };
    return [...found.slice(0, -1), row, ...found.slice(-1)];
  }, [notes, boards, recent, hits, query, byMeaning, meaning, ask, sources, searches, plugins]);
  const current = Math.min(selected, Math.max(0, rows.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (row: Row | undefined, how: OpenHow = "here") => {
    if (!row) return;
    if (!row.stay) {
      keepSearch(query);
      close();
    }
    row.run(how);
  };

  return (
    <Modal plain label="Search and commands" onClose={close} className="kasten-palette">
      <input
        autoFocus
        className="kasten-palette-input"
        placeholder="Search pages, text and commands…"
        aria-label="Search"
        aria-controls="kasten-palette-results"
        aria-activedescendant={rows.length > 0 ? `kasten-palette-row-${current}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setByMeaning(null);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          else if (e.key === "ArrowDown") setSelected(Math.min(current + 1, rows.length - 1));
          else if (e.key === "ArrowUp") setSelected(Math.max(current - 1, 0));
          else if (e.key === "Enter") run(rows[current], howFrom(e));
          else return;
          e.preventDefault();
        }}
      />
      <div ref={list} id="kasten-palette-results" className="kasten-palette-list" role="listbox" aria-label="Results">
        {rows.length === 0 && <p className="kasten-palette-empty">{byMeaning ? "Nothing near that yet" : "Nothing found"}</p>}
        {rows.map((row, i) => (
          <button
            key={row.key}
            type="button"
            role="option"
            id={`kasten-palette-row-${i}`}
            data-index={i}
            aria-selected={i === current}
            className="kasten-palette-row"
            onMouseMove={() => setSelected(i)}
            onClick={(e) => run(row, howFrom(e))}
          >
            <span className="kasten-palette-icon" aria-hidden="true">
              <IconOrEmoji icon={row.icon} />
            </span>
            <span className="kasten-palette-text">
              <span className="kasten-palette-label">{row.label}</span>
              {row.detail && <span className="kasten-palette-detail">{row.detail}</span>}
            </span>
            {row.hint && <kbd>{row.hint}</kbd>}
          </button>
        ))}
      </div>
      <div className="kasten-palette-foot">
        <span>↑↓ to choose</span>
        <span>↵ to open</span>
        <span>{editorKeys("Ctrl+↵ new tab · Shift+↵ side stack · Alt+↵ split")}</span>
        <span>Esc to close</span>
      </div>
    </Modal>
  );
}

/** What a search by meaning shows in the palette. */
function meaningRows({ query, found, error }: ByMeaning): Row[] {
  const { openPath } = useWorkspace.getState();
  if (error) {
    return [{ key: "meaning-error", icon: lineIcon("alert"), label: "Search by meaning did not work", detail: error, run: () => openSettingsAt({ group: "search" }) }];
  }
  if (!found) return [{ key: "meaning-wait", icon: lineIcon("sparkle"), label: `Finding notes about “${query}”…`, stay: true, run: () => {} }];
  return found.map((n) => ({
    key: `meaning:${n.path}`,
    icon: n.icon || lineIcon("page"),
    label: n.title,
    detail: `${Math.round(n.score * 100)}% alike${n.excerpt ? ` · ${readable(n.excerpt)}` : ""}`,
    run: (how) => openPath(n.path, how),
  }));
}

function place(note: NoteMeta): string {
  if (note.kind === "journal") return "Journal";
  // Archived projects stay findable; the palette says what they are.
  if (note.kind === "project" && isArchived(note)) return "Archived project";
  if (note.project) return `Project · ${note.project}`;
  if (note.path.startsWith("inbox/")) return "Inbox";
  return "";
}

function buildRows(notes: NoteMeta[], boards: readonly BoardInfo[], recent: string[], hits: Hit[], query: string, sources: readonly SourceInfo[] | null): Row[] {
  const { openPath, openJournal, create } = useWorkspace.getState();
  const { keymap } = useKeys.getState();
  const q = query.trim();
  const boardRow = (board: BoardInfo): Row => ({
    key: `board:${board.path}`,
    icon: lineIcon("board"),
    label: board.title,
    detail: board.project ? `Whiteboard · ${projectTitle(notes, board.project)}` : "Whiteboard",
    run: (how) => openPath(board.path, how),
  });
  const pageRow = (note: NoteMeta, detail = whereIfShared(note, notes) ?? place(note)): Row => ({
    key: `page:${note.path}`,
    icon: iconOf(note),
    label: titleOf(note),
    detail,
    run: (how) => openPath(note.path, how),
  });

  const scored = allCommands().filter((c) => !c.when || c.when()).map((c) => ({ c, s: Math.max(score(c.label, q), c.words ? score(c.words, q) / 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const toRow = ({ c }: (typeof scored)[number]): Row => ({ key: `cmd:${c.id}`, icon: lineIcon("chevron"), label: c.label, hint: keyLabel(keymap, c.id) || undefined, run: () => c.run() });
  const commands = scored.map(toRow);
  // A command named by the query beats pages that merely mention it.
  const strong = scored.filter((x) => x.s >= 60).map(toRow);
  const weak = scored.filter((x) => x.s < 60).map(toRow);

  if (!q) {
    // Recent pages and boards, then the latest edited pages up to eight.
    const seen: Row[] = [];
    for (const path of recent) {
      const board = path.endsWith(".canvas") ? boards.find((b) => b.path === path) : undefined;
      const note = board ? undefined : noteAt(notes, path);
      if (board) seen.push(boardRow(board));
      else if (note && note.kind !== "template") seen.push(pageRow(note));
    }
    for (const n of byModified(notes)) {
      if (seen.length >= 8) break;
      if (!recent.includes(n.path)) seen.push(pageRow(n));
    }
    return [...seen.slice(0, 8), ...commands.slice(0, 6)];
  }

  const byTitle = matchTitles(notes, q, q.startsWith("#") ? 0 : 8).map((note) => pageRow(note));
  const boardRows = boards
    .map((board) => ({ board, s: score(board.title, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => boardRow(x.board));
  const wanted = q.replace(/^#/, "").toLowerCase();
  const tags = wanted
    ? tagCounts(notes)
        .filter((t) => t.tag.toLowerCase().includes(wanted))
        .slice(0, q.startsWith("#") ? 8 : 3)
        .map((t): Row => ({ key: `tag:${t.tag}`, icon: lineIcon("hash"), label: `#${t.tag}`, detail: `${t.count} ${t.count === 1 ? "note" : "notes"} · Tag Database`, run: (how) => useWorkspace.getState().go(tagPlace(t.tag), how) }))
    : [];
  const titled = new Set(byTitle.map((r) => r.key));
  const inText = hits
    .filter((h) => h.snippet && !titled.has(`page:${h.path}`))
    .slice(0, 8)
    .map((h): Row => {
      const note = noteAt(notes, h.path);
      return {
        key: `text:${h.path}`,
        icon: note ? iconOf(note) : lineIcon("page"),
        label: note ? titleOf(note) : h.title,
        detail: readable(h.snippet),
        run: (how) => openAt(h.path, { find: searchedWords(query) }, how),
      };
    });
  const extra: Row[] = isDay(q)
    ? [{ key: "day", icon: lineIcon("journal"), label: `Journal for ${q}`, run: (how) => void openJournal(q, how) }]
    : findByTitle(notes, q)
      ? []
      : [{ key: "create", icon: lineIcon("page-plus"), label: `New page “${q}”`, run: () => void create({ kind: "page", title: q }) }];
  const everything: Row = { key: "search", icon: lineIcon("search"), label: `Search everything for “${q}”`, hint: keyLabel(keymap, "search") || undefined, run: () => searchLibrary(q) };
  // The search kept under a name, asked for from the same box.
  const keep: Row = { key: "collection", icon: lineIcon("filter"), label: `Save “${q}” as a collection…`, run: () => newCollectionFromQuery(q) };
  if (q.startsWith("#")) return [...tags, everything, keep];
  // A board named just so comes first; others follow the pages.
  const exact = boardRows.filter((r) => r.label.toLowerCase() === q.toLowerCase());
  const others = boardRows.filter((r) => !exact.includes(r));
  return [...exact, ...byTitle, ...others, ...pdfRows(sources, q), ...tags, ...settingsRows(q), ...strong.slice(0, 5), ...inText, ...weak.slice(0, Math.max(0, 5 - strong.length)), ...extra, everything, keep];
}
