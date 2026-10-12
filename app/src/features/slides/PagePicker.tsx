import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Modal } from "../../ui/Modal";
import { projectTitle } from "../boards/store";
import { titleOf } from "../workspace/names";
import { projects } from "../workspace/tree";
import { useWorkspace } from "../workspace/store";
import { hostPage, isPage, usePagePicker } from "./page-picker";

/** The most rows listed at once: a vault of thousands is searched, not scrolled. */
const MOST = 60;
const RECENT = 8;

/** Choosing a page of the vault for a slide: a search, the pages opened lately, and a filter by project. */
function PagePicker() {
  const notes = useWorkspace((s) => s.notes);
  const recent = useWorkspace((s) => s.recent);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const words = query.trim().toLowerCase();

  const pages = useMemo(() => notes.filter(isPage), [notes]);
  const folders = useMemo(() => projects(pages), [pages]);
  const shown = useMemo(() => {
    const inProject = project ? pages.filter((n) => n.project === project) : pages;
    if (words) {
      const terms = words.split(/\s+/);
      const hits = inProject.filter((n) => {
        const text = `${n.title} ${n.path} ${n.excerpt}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      });
      // A title that begins with what was typed first, then the rest as they were last changed.
      return hits.sort((a, b) => Number(b.title.toLowerCase().startsWith(words)) - Number(a.title.toLowerCase().startsWith(words)) || b.modified - a.modified).slice(0, MOST);
    }
    const byPath = new Map(inProject.map((n) => [n.path, n]));
    const lately = recent.flatMap((path) => (byPath.has(path) ? [byPath.get(path)!] : [])).slice(0, RECENT);
    const rest = [...inProject].filter((n) => !lately.includes(n)).sort((a, b) => b.modified - a.modified);
    return [...lately, ...rest].slice(0, MOST);
  }, [pages, recent, project, words]);
  const lately = !words && shown.length > 0 ? Math.min(RECENT, recent.filter((path) => shown.some((n) => n.path === path)).length) : 0;
  const active = Math.min(at, Math.max(shown.length - 1, 0));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const choose = (index: number) => {
    const note = shown[index];
    if (note) usePagePicker.getState().answer(hostPage(note));
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length > 0) setAt((active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <Modal label="Choose a page" onClose={() => usePagePicker.getState().answer(null)} className="w-[min(560px,94vw)] p-5">
      <h2 className="text-16 font-semibold">Choose a page</h2>
      <div className="mt-3 flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted focus-within:border-accent/60">
          <Icon name="search" />
          <input
            autoFocus
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="slides-page-list"
            aria-label="Find a page"
            placeholder="Find a page"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setAt(0);
            }}
            onKeyDown={onKey}
            className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none"
          />
        </label>
        {folders.length > 0 && (
          <select aria-label="Project" value={project} onChange={(event) => (setProject(event.target.value), setAt(0))} className="h-9 max-w-[180px] rounded-lg border border-line bg-canvas px-2 text-13 text-ink">
            <option value="">All pages</option>
            {folders.map((folder) => (
              <option key={folder.path} value={folder.project ?? ""}>
                {titleOf(folder)}
              </option>
            ))}
          </select>
        )}
      </div>
      <ul id="slides-page-list" ref={list} role="listbox" aria-label="Pages" className="mt-3 flex max-h-[min(380px,52vh)] flex-col gap-0.5 overflow-auto">
        {shown.map((note, index) => (
          <li key={note.path} role="presentation">
            {index === 0 && lately > 0 && <p className="px-2 pb-1 pt-0.5 text-12 text-muted">Recent</p>}
            {index === lately && lately > 0 && <p className="px-2 pb-1 pt-2 text-12 text-muted">All pages</p>}
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setAt(index)}
              onClick={() => choose(index)}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${index === active ? "bg-hover" : ""}`}
            >
              <span className="w-5 shrink-0 text-center" aria-hidden="true">
                {note.icon ? <IconOrEmoji icon={note.icon} /> : <Icon name="page" className="size-4 text-muted" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-14 font-medium">{hostPage(note).title}</span>
                <span className="block truncate text-12 text-muted">{note.project ? projectTitle(pages, note.project) : note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "Library"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="mt-3 text-13 text-muted">{words ? "No page matches." : "No pages yet."}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-12 text-muted">Pick one, then choose how it goes on the slide.</p>
        <Button onClick={() => usePagePicker.getState().answer(null)}>Cancel</Button>
      </div>
    </Modal>
  );
}

/** The picker, when a deck's editor is waiting for a page. */
export function PagePickerHost() {
  const waiting = usePagePicker((s) => s.waiting !== null);
  // A picker left open when the deck is closed gives up.
  useEffect(() => () => usePagePicker.getState().answer(null), []);
  return waiting ? <PagePicker /> : null;
}
