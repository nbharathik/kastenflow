// The quick capture box: type, Tab to choose where it goes, Enter to save.
// The place button (or Ctrl+K) opens a picker that narrows the places and
// any page as you type; recent places come first. Esc, or clicking away,
// hides the window and keeps the draft for next time. Saving goes through the
// same core commands as the main window, which then hears what was captured.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";

import type { VaultClient } from "../lib/vault/types";
import { saveCapture, type Captured } from "./save";
import { TargetPicker } from "./TargetPicker";
import { INBOX, MAX_RECENT, nextTarget, orderedTargets, placeName, readRecent, remember, wheelStep, type Places, type Target } from "./targets";

const DRAFT = "kasten.capture.draft";
const RECENT = "kasten.capture.recent";
/** How tall the window grows to while the picker is open, in pixels. */
const PICKER_HEIGHT = 420;
const BOX_HEIGHT = 200;

export interface CaptureHost {
  client: VaultClient;
  /** Hides the window; the draft stays. */
  hide(): void;
  /** Tells the main window what was captured, and hides. */
  done(captured: Captured): void;
  /** Calls `then` each time the window opens; returns how to stop. */
  onOpen(then: () => void): () => void;
  /** Gives the window room for the picker (a height), and takes it back. */
  resize?(height: number): void;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // No storage: the draft and the recent places last while the window does.
  }
}

export function CaptureBox({ host }: { host: CaptureHost }) {
  const [text, setText] = useState(() => load(DRAFT) ?? "");
  const [projects, setProjects] = useState<Places["projects"]>([]);
  const [pages, setPages] = useState<Places["pages"]>([]);
  const [recent, setRecent] = useState<Target[]>(() => readRecent(load(RECENT)));
  const [target, setTarget] = useState<Target>(INBOX);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastWheel = useRef(0);

  const places = useMemo<Places>(() => ({ projects, recent, pages }), [projects, recent, pages]);
  // Tab and the wheel go round the places in the order the picker lists them.
  const targets = useMemo(() => orderedTargets(places), [places]);

  const refresh = useCallback(() => {
    // Each time the window opens, the box is ready to type in, the picker shut.
    setPicking(false);
    box.current?.focus();
    host.client.list().then(
      (notes) => {
        setProjects(notes.filter((n) => n.kind === "project" && n.project).map((n) => ({ slug: n.project!, title: n.title })));
        // A project's own page is offered as the project.
        setPages(notes.filter((n) => n.kind !== "template" && n.kind !== "project").map((n) => ({ path: n.path, title: n.title, modified: n.modified })));
      },
      () => {},
    );
  }, [host]);
  useEffect(() => {
    refresh();
    return host.onOpen(refresh);
  }, [host, refresh]);

  // The window grows while the picker is open, and shrinks back after it.
  const sized = useRef(BOX_HEIGHT);
  useEffect(() => {
    const wanted = picking ? PICKER_HEIGHT : BOX_HEIGHT;
    if (sized.current === wanted) return;
    sized.current = wanted;
    host.resize?.(wanted);
  }, [host, picking]);
  useEffect(
    () => () => {
      if (sized.current !== BOX_HEIGHT) host.resize?.(BOX_HEIGHT);
    },
    [host],
  );

  const closePicker = () => {
    setPicking(false);
    box.current?.focus();
  };
  const choose = (next: Target) => {
    setTarget(next);
    closePicker();
  };

  const save = async () => {
    const markdown = text.trim();
    if (!markdown || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const captured = await saveCapture(host.client, target, markdown);
      const next = remember(recent, target).slice(0, MAX_RECENT);
      setRecent(next);
      store(RECENT, JSON.stringify(next));
      setText("");
      store(DRAFT, "");
      host.done(captured);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    } else if (event.key === "Tab") {
      event.preventDefault();
      setTarget((at) => nextTarget(targets, at, event.shiftKey));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPicking(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      host.hide();
    }
  };

  // The wheel over the place button goes round the places too.
  const onWheel = (event: WheelEvent) => {
    const step = wheelStep(event.deltaY);
    const now = Date.now();
    if (step === 0 || now - lastWheel.current < 90) return;
    lastWheel.current = now;
    setTarget((at) => nextTarget(targets, at, step < 0));
  };

  return (
    <div className="kasten-capture">
      <div className="kasten-capture-main">
        <textarea
          ref={box}
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            store(DRAFT, e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Capture a thought, or paste a link…"
          aria-label="Quick capture"
          spellCheck
          className="kasten-capture-text"
        />
        {picking && <TargetPicker places={places} current={target} onPick={choose} onClose={closePicker} />}
      </div>
      <footer className="kasten-capture-foot">
        <button
          type="button"
          className="kasten-capture-target"
          aria-label={`Save to ${placeName(target)}; Tab changes it, or click to choose`}
          aria-haspopup="dialog"
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
          onWheel={onWheel}
        >
          → {placeName(target)}
        </button>
        {problem ? (
          <span role="alert" className="kasten-capture-problem">
            {problem}
          </span>
        ) : (
          <span className="kasten-capture-hint">Tab: where · Ctrl+K: any page · Enter: save · Esc: hide</span>
        )}
      </footer>
    </div>
  );
}
