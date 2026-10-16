import { type CSSProperties, type JSX, type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { editorOf, focusedNow, giveFocusBack, lastEditorRoot } from "../focus/home.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { IconButton, TextButton } from "../ui/Button.tsx";
import { holdCover } from "../ui/covers.ts";
import { Toggle } from "../ui/Fields.tsx";
import { useEditor } from "../useEditor.ts";
import { type FindMatch, type FindOptions, compareAt, findAll, sameMatch } from "./find.ts";
import { replaceOne } from "./find-replace.ts";
import "./find.css";

interface Settings extends Required<FindOptions> {
  find: string;
  replace: string;
}

const DEFAULTS: Settings = { find: "", replace: "", caseSensitive: false, wholeWord: false, includeNotes: true };

/** What was looked for last in each deck being edited, for when the card is opened again. */
const remembered = new WeakMap<EditorSession, Settings>();

/** Keeps the card at the top right of the slide area, wherever the editor sits in the window. */
function usePlacement(card: RefObject<HTMLDivElement | null>): CSSProperties {
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const area = card.current?.closest(".ks-editor")?.querySelector(".ks-center");
    if (!area) return;
    const update = () => {
      const box = area.getBoundingClientRect();
      if (box.width > 0) setPlace({ top: box.top + 12, right: Math.max(8, window.innerWidth - box.right + 12) });
    };
    update();
    const watch = new ResizeObserver(update);
    watch.observe(area);
    window.addEventListener("resize", update);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [card]);
  return place;
}

/** Find and replace: a small card over the top right of the slide, which leaves the slide to look at and work on. */
export function FindDialog({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const { deck } = useEditor(session);
  const [settings, setSettings] = useState<Settings>(() => remembered.get(session) ?? DEFAULTS);
  const [cursor, setCursor] = useState<FindMatch | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const place = usePlacement(card);
  const { find, replace } = settings;
  const options: FindOptions = { caseSensitive: settings.caseSensitive, wholeWord: settings.wholeWord, includeNotes: settings.includeNotes };

  useEffect(() => {
    remembered.set(session, settings);
  }, [session, settings]);

  useEffect(() => {
    const before = focusedNow();
    const editor = editorOf(card.current) ?? lastEditorRoot();
    field.current?.focus();
    field.current?.select();
    const release = holdCover();
    // Closing hands the keys back to whatever had them: usually the slide, and the slide when that place is gone (a menu row).
    return () => {
      release();
      giveFocusBack(before, editor);
    };
  }, []);

  // Mod+F and Mod+H come back to the search box instead of the browser's own.
  useEffect(() => {
    const again = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "f" || event.key.toLowerCase() === "h")) {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    document.addEventListener("keydown", again);
    return () => document.removeEventListener("keydown", again);
  }, []);

  const matches = useMemo(
    () => findAll(deck, find, { caseSensitive: settings.caseSensitive, wholeWord: settings.wholeWord, includeNotes: settings.includeNotes }),
    [deck, find, settings.caseSensitive, settings.wholeWord, settings.includeNotes],
  );
  const at = cursor ? matches.findIndex((m) => sameMatch(m, cursor)) : -1;
  const status = said ?? (find === "" ? "" : matches.length === 0 ? "No matches" : at >= 0 ? `${at + 1} of ${matches.length}` : matches.length === 1 ? "1 match" : `${matches.length} matches`);

  const change = (next: Partial<Settings>) => {
    setSettings({ ...settings, ...next });
    setCursor(null);
    setSaid(null);
  };

  /** Shows a match: its slide, and the box it is in (or the notes). */
  const show = (match: FindMatch) => {
    session.goTo(match.slide);
    if (match.notes) {
      session.select([]);
      if (!ui.state.notesOpen) ui.toggleNotes();
    } else if (match.element) {
      session.select([match.element]);
    }
    setCursor(match);
    setSaid(null);
  };

  /** The place a search goes on from: after the match it is at, else from the start of the slide shown. */
  const from = (direction: 1 | -1): number[] => {
    if (cursor) return cursor.at;
    const slide = session.deck.slides.findIndex((s) => s.id === session.state.slideId);
    return [Math.max(slide, 0) + (direction < 0 ? 1 : 0)];
  };

  const step = (direction: 1 | -1) => {
    const list = findAll(session.deck, find, options);
    if (list.length === 0) return setCursor(null);
    const start = from(direction);
    const next =
      direction > 0 ? (list.find((m) => compareAt(m.at, start) > 0) ?? list[0]) : ([...list].reverse().find((m) => compareAt(m.at, start) < 0) ?? list[list.length - 1]);
    if (next) show(next);
  };

  /** Replaces the match shown, then goes to the next. With none shown yet it shows the first, so what will change is seen before it does. */
  const replaceCurrent = () => {
    const target = cursor && findAll(session.deck, find, options).find((m) => sameMatch(m, cursor));
    if (!target) return step(1);
    if (!replaceOne(session, target, replace)) return step(1);
    // The words that went in are not looked at again: go on from their end.
    const past = [...target.at.slice(0, -1), target.index + replace.length - 1];
    const rest = findAll(session.deck, find, options);
    const next = rest.find((m) => compareAt(m.at, past) > 0) ?? rest[0];
    if (next) show(next);
    else {
      setCursor(null);
      setSaid(null);
    }
  };

  const replaceAll = () => {
    const count = session.elements.replaceAll(find, replace, options);
    setCursor(null);
    setSaid(count === 0 ? "No matches" : `Replaced ${count}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      ui.openDialog(null);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && (event.target instanceof HTMLInputElement && event.target.type === "text")) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  const none = find === "" || matches.length === 0;
  return (
    <div ref={card} className="ks-dialog ks-find" role="dialog" aria-label="Find and replace" style={place} onKeyDown={onKeyDown}>
      <div className="ks-find-head">
        <h2 className="ks-dialog-title">Find and replace</h2>
        <IconButton icon="x" label="Close" onClick={() => ui.openDialog(null)} />
      </div>
      <div className="ks-find-fields">
        <div className="ks-find-row">
          <input ref={field} className="ks-input" aria-label="Find" placeholder="Find" value={find} onChange={(event) => change({ find: event.target.value })} />
          <span className="ks-find-status" role="status" aria-live="polite">
            {status}
          </span>
        </div>
        <input className="ks-input" aria-label="Replace with" placeholder="Replace with" value={replace} onChange={(event) => change({ replace: event.target.value })} />
      </div>
      <div className="ks-find-options">
        <Toggle label="Match case" on={settings.caseSensitive} onChange={(on) => change({ caseSensitive: on })} />
        <Toggle label="Whole word" on={settings.wholeWord} onChange={(on) => change({ wholeWord: on })} />
        <Toggle label="Also search notes" on={settings.includeNotes} onChange={(on) => change({ includeNotes: on })} />
      </div>
      <div className="ks-find-actions">
        <span className="ks-find-steps">
          <IconButton icon="arrow-up" label="Find previous" keys="Shift+Enter" disabled={none} onClick={() => step(-1)} />
          <IconButton icon="arrow-down" label="Find next" keys="Enter" disabled={none} onClick={() => step(1)} />
        </span>
        <TextButton disabled={none} onClick={replaceCurrent}>
          Replace
        </TextButton>
        <TextButton disabled={none} onClick={replaceAll}>
          Replace all
        </TextButton>
      </div>
    </div>
  );
}
