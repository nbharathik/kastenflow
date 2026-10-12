// The capture box's place picker: type to narrow the places (the Inbox,
// today's journal, recent ones, projects) and, once something is typed, any
// page by its title. Tab, Shift+Tab, ↑ ↓ and the mouse wheel move through
// them and Enter chooses; Esc closes the picker and not the capture window.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Icon, type IconName } from "../ui/Icon";
import { around, pickerChoices, placeName, sameTarget, wheelStep, type Places, type Target } from "./targets";

/** The shortest time between two wheel steps, so a trackpad's flick moves one place, not twenty. */
const WHEEL_PAUSE_MS = 90;

const ICONS: Record<Target["kind"], IconName> = { inbox: "inbox", journal: "journal", project: "project", page: "page" };
const KIND_WORDS: Record<Target["kind"], string> = { inbox: "", journal: "", project: "Project", page: "Page" };

export function TargetPicker({ places, current, onPick, onClose }: { places: Places; current: Target; onPick(target: Target): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const choices = useMemo(() => pickerChoices(query, places), [query, places]);
  // It opens on the place already chosen, so Enter alone keeps it.
  const [asked, setAsked] = useState(() => Math.max(0, pickerChoices("", places).findIndex((t) => sameTarget(t, current))));
  const active = Math.min(asked, Math.max(0, choices.length - 1));
  const id = useId();
  const lastWheel = useRef(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, choices]);

  const move = (step: number) => setAsked(around(active, step, choices.length));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) move(1);
    else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) move(-1);
    else if (event.key === "Enter") {
      const picked = choices[active];
      if (picked) onPick(picked);
    } else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  // The wheel moves through the places instead of scrolling them: a listener
  // of its own, as React's wheel listeners cannot cancel the scroll.
  const stepWheel = useRef((_step: number) => {});
  useEffect(() => {
    stepWheel.current = move;
  });
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const step = wheelStep(event.deltaY);
      if (step === 0) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheel.current < WHEEL_PAUSE_MS) return;
      lastWheel.current = now;
      stepWheel.current(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={dialog} className="kasten-capture-picker" role="dialog" aria-label="Where to save">
      <input
        autoFocus
        className="kasten-capture-search"
        value={query}
        placeholder="Type to find a place or a page…"
        aria-label="Find a place"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={choices.length > 0 ? `${id}-${active}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setAsked(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Places" className="kasten-capture-list">
        {choices.map((choice, i) => (
          <li
            key={choice.kind === "project" ? `project:${choice.slug}` : choice.kind === "page" ? `page:${choice.path}` : choice.kind}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`kasten-capture-option${i === active ? " is-active" : ""}`}
            onMouseMove={() => i !== active && setAsked(i)}
            // The pointer would take the focus from the field before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(choice)}
          >
            <Icon name={ICONS[choice.kind]} className="size-4 shrink-0" />
            <span className="kasten-capture-option-name">{placeName(choice)}</span>
            {sameTarget(choice, current) ? <span className="kasten-capture-option-hint">Chosen</span> : KIND_WORDS[choice.kind] && <span className="kasten-capture-option-hint">{KIND_WORDS[choice.kind]}</span>}
          </li>
        ))}
        {choices.length === 0 && <li className="kasten-capture-none">No place or page called that</li>}
      </ul>
    </div>
  );
}
