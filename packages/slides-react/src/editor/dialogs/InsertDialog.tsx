import { type JSX, type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";

import { ShapePreview } from "../menus/previews.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import type { HostImage } from "../host.ts";
import { SECTIONS, type PaletteItem, paletteItems } from "./insert-items.ts";
import { rank } from "./palette-rank.ts";
import type { DialogProps } from "./types.ts";
import "./insert.css";

/** How far Page Up and Page Down move down the list. */
const PAGE = 8;

/** Sections for the list: with nothing typed, by kind under a heading; while typing, one list ranked by how well things match. */
function sectionsOf(query: string, items: readonly PaletteItem[]): { title: string | null; items: PaletteItem[] }[] {
  if (query.trim() !== "") return [{ title: null, items: [...items] }];
  return SECTIONS.map((title) => ({ title: title as string | null, items: items.filter((item) => item.group === title) })).filter((section) => section.items.length > 0);
}

/**
 * The insert palette: a box to type in and a list under it of everything that
 * can be put on the slide, the layouts to add as a slide, the pictures the host
 * holds, and every command that can be done now. Typing narrows and ranks the
 * list; the arrow keys walk it, Enter does the one in view and Escape leaves.
 */
export function InsertDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const context = useMemo(() => ({ session, ui }), [session, ui]);
  const [held, setHeld] = useState<HostImage[]>([]);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
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
  const shown = useMemo(() => rank(query, everything), [query, everything]);
  const sections = useMemo(() => sectionsOf(query, shown), [query, shown]);
  const active = Math.min(at, Math.max(shown.length - 1, 0));
  const optionId = (item: PaletteItem) => `${uid}-${item.id.replace(/[^\w-]/g, "_")}`;
  const current = shown[active];

  // What is in view stays in view as the arrow keys walk the list.
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current?.id]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    // The palette goes first: a command may open a dialog of its own, and the slide is what the focus goes back to.
    onClose();
    void item.run(context);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const count = shown.length;
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
    <Dialog title="Insert gallery" width={580} onClose={onClose}>
      <div className="ks-pl">
        <div className="ks-pl-search">
          <Icon name="search" size={16} />
          <input
            className="ks-pl-input"
            role="combobox"
            aria-label="Insert or run a command"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            placeholder="Insert or run a command…"
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
        <div id={`${uid}-list`} className="ks-pl-list" role="listbox" aria-label="Things to insert and commands">
          {sections.map((section) => (
            <div key={section.title ?? "results"} role="group" aria-label={section.title ?? "Results"}>
              {section.title ? (
                <div className="ks-pl-head" aria-hidden="true">
                  {section.title}
                </div>
              ) : null}
              {section.items.map((item) => (
                <div
                  key={item.id}
                  id={optionId(item)}
                  role="option"
                  aria-selected={item === current}
                  className={`ks-pl-row${item === current ? " is-active" : ""}`}
                  onMouseMove={() => shown[active] !== item && setAt(shown.indexOf(item))}
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
          {shown.length === 0 ? <p className="ks-pl-none">Nothing matches “{query.trim()}”.</p> : null}
        </div>
        <p className="ks-pl-status" role="status">
          {shown.length === 0 ? "No results" : `${shown.length} ${shown.length === 1 ? "result" : "results"}`}
        </p>
      </div>
    </Dialog>
  );
}
