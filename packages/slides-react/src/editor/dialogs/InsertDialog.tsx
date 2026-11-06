import { type JSX, type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";

import { type PaletteMode, chromeOf } from "../chrome/chrome.ts";
import { notePalette, recentPalette } from "../chrome/recents.ts";
import { ShapePreview } from "../menus/previews.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import type { HostImage } from "../host.ts";
import { SECTIONS, type PaletteItem, paletteItems } from "./insert-items.ts";
import { MODES, inMode, modeOfQuery, recentFirst } from "./palette-modes.ts";
import { rank } from "./palette-rank.ts";
import type { DialogProps } from "./types.ts";
import "./insert.css";

/** How far Page Up and Page Down move down the list. */
const PAGE = 8;
/** The most rows the "Recent" heading holds. */
const RECENT_SHOWN = 5;

interface Block {
  title: string | null;
  items: PaletteItem[];
}

/**
 * Blocks for the list: with nothing typed, what was chosen lately first and then the rest by kind under headings; while typing, one list
 * ranked by how well things match.
 */
function blocksOf(typed: boolean, items: readonly PaletteItem[], recent: readonly PaletteItem[]): Block[] {
  if (typed) return [{ title: null, items: [...items] }];
  const lately = new Set(recent);
  const blocks: Block[] = recent.length > 0 ? [{ title: "Recent", items: [...recent] }] : [];
  for (const title of SECTIONS) {
    const here = items.filter((item) => item.group === title && !lately.has(item));
    if (here.length > 0) blocks.push({ title, items: here });
  }
  return blocks;
}

/**
 * The command palette: a box to type in and a list under it of every command (from the menus, with their keys), everything that can be put
 * on the slide, the layouts to add as a slide, the slides to go to, and the pictures the host holds. Typing narrows and ranks the list with
 * a fuzzy match; what was chosen lately comes first; the arrow keys walk it, Enter does the one in view and Escape leaves. Buttons under the
 * box (or ">", "+", "#" typed first) keep to commands, things to insert, or slides.
 */
export function InsertDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const context = useMemo(() => ({ session, ui }), [session, ui]);
  const [held, setHeld] = useState<HostImage[]>([]);
  const [query, setQuery] = useState("");
  const [part, setPart] = useState<PaletteMode>(() => chromeOf(ui).takePalette());
  const [at, setAt] = useState(0);
  const [lately] = useState(recentPalette);
  const uid = useId();

  // The gallery's pictures come when the host has them.
  useEffect(() => {
    let live = true;
    session.host.images?.().then(
      (list) => live && setHeld(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [session]);

  const everything = useMemo(() => paletteItems(context, held), [context, held]);
  const { mode, words } = modeOfQuery(query, part);
  const typed = words.trim() !== "";
  const ordered = useMemo(() => recentFirst(inMode(everything, mode), lately), [everything, mode, lately]);
  const recent = useMemo(() => (typed ? [] : ordered.filter((item) => lately.includes(item.id)).slice(0, RECENT_SHOWN)), [ordered, lately, typed]);
  const shown = useMemo(() => (typed ? rank(words, ordered) : ordered), [typed, words, ordered]);
  const blocks = useMemo(() => blocksOf(typed, shown, recent), [typed, shown, recent]);
  // The order of the keys is the order on the screen.
  const flat = useMemo(() => blocks.flatMap((block) => block.items), [blocks]);
  const active = Math.min(at, Math.max(flat.length - 1, 0));
  const optionId = (item: PaletteItem) => `${uid}-${item.id.replace(/[^\w-]/g, "_")}`;
  const current = flat[active];

  // What is in view stays in view as the arrow keys walk the list.
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current?.id]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    notePalette(item.id);
    // The palette goes first: a command may open a dialog of its own, and the slide is what the focus goes back to.
    onClose();
    void item.run(context);
  };

  const pick = (next: PaletteMode) => {
    setPart(next);
    // A character typed first would win over the button: it goes.
    setQuery(modeOfQuery(query, next).words);
    setAt(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const count = flat.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count > 0) setAt((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      setAt(Math.min(Math.max(active + (event.key === "PageDown" ? PAGE : -PAGE), 0), Math.max(count - 1, 0)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(current);
    }
  };

  return (
    <Dialog title="Command palette" width={580} onClose={onClose}>
      <div className="ks-pl">
        <div className="ks-pl-search">
          <Icon name="search" size={16} />
          <input
            className="ks-pl-input"
            role="combobox"
            aria-label="Search commands, things to insert and slides"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            placeholder="Type a command, something to insert, or a slide…"
            autoComplete="off"
            spellCheck={false}
            data-autofocus=""
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setAt(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="ks-pl-modes" role="group" aria-label="Show">
          {MODES.map((choice) => (
            <button
              key={choice.mode}
              type="button"
              className={`ks-pl-mode${choice.mode === mode ? " is-on" : ""}`}
              aria-pressed={choice.mode === mode}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(choice.mode)}
            >
              {choice.label}
            </button>
          ))}
          <span className="ks-pl-tip">Start with &gt; for commands, + to insert, # for slides</span>
        </div>
        <div id={`${uid}-list`} className="ks-pl-list" role="listbox" aria-label="Commands, things to insert and slides">
          {blocks.map((block) => (
            <div key={block.title ?? "results"} role="group" aria-label={block.title ?? "Results"}>
              {block.title ? (
                <div className="ks-pl-head" aria-hidden="true">
                  {block.title}
                </div>
              ) : null}
              {block.items.map((item) => (
                <div
                  key={item.id}
                  id={optionId(item)}
                  role="option"
                  aria-selected={item === current}
                  className={`ks-pl-row${item === current ? " is-active" : ""}`}
                  onMouseMove={() => current !== item && setAt(flat.indexOf(item))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <span className="ks-pl-icon" aria-hidden="true">
                    {item.shape ? <ShapePreview preset={item.shape} size={18} /> : item.icon ? <Icon name={item.icon} size={16} /> : null}
                  </span>
                  <span className="ks-pl-label">
                    {item.label}
                    {item.description ? <span className="ks-pl-desc">{item.description}</span> : null}
                  </span>
                  {item.keys ? <kbd className="ks-kbd ks-pl-keys">{item.keys}</kbd> : item.hint ? <span className="ks-pl-hint">{item.hint}</span> : null}
                </div>
              ))}
            </div>
          ))}
          {flat.length === 0 ? <p className="ks-pl-none">{typed ? `Nothing matches “${words.trim()}”.` : "Nothing to list here."}</p> : null}
        </div>
        <p className="ks-pl-status" role="status">
          {flat.length === 0 ? "No results" : `${flat.length} ${flat.length === 1 ? "result" : "results"}`}
        </p>
      </div>
    </Dialog>
  );
}
