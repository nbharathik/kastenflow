// A small list to choose from, opened where the person is: type to narrow it,
// arrows and Enter (or a click) to choose, Escape to leave. The citation
// picker and the "add to which document" list both use it. It is mounted on
// demand, so nothing here is drawn or loaded until one is opened.

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { sentence } from "./backend";
import "./picker.css";

export interface PickerItem {
  id: string;
  label: string;
  /** Smaller text beside the label (authors and year, a folder). */
  detail?: string;
}

export interface PickerOptions {
  /** Names the list for a screen reader and heads it. */
  title: string;
  placeholder: string;
  load(): Promise<PickerItem[]>;
  /** One plain sentence when there is nothing to choose from, and a way on. */
  empty: { text: string; action?: { label: string; run(): void } };
  onPick(item: PickerItem): void;
}

/** The most rows drawn at once (the rest is reached by typing). */
const MOST_SHOWN = 100;

/** The items that hold every word of `query`, best first as given. */
export function narrow(items: readonly PickerItem[], query: string): PickerItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length === 0 ? items : items.filter((item) => words.every((w) => `${item.label} ${item.detail ?? ""} ${item.id}`.toLowerCase().includes(w)));
  return found.slice(0, MOST_SHOWN);
}

function Picker({ options, onClose }: { options: PickerOptions; onClose: () => void }) {
  const [items, setItems] = useState<PickerItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    setProblem(null);
    options.load().then(
      (loaded) => live && setItems(loaded),
      (err: unknown) => live && setProblem(sentence(err)),
    );
    return () => {
      live = false;
    };
  }, [options, attempt]);

  const shown = useMemo(() => narrow(items ?? [], query), [items, query]);
  const at = Math.min(active, Math.max(shown.length - 1, 0));
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView?.({ block: "nearest" });
  }, [at, shown]);

  const pick = (item: PickerItem | undefined) => {
    if (!item) return;
    onClose();
    options.onPick(item);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(shown.length - 1, 0)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(shown[at]);
    }
  };

  const nothingAtAll = items !== null && items.length === 0;
  return (
    <Modal label={options.title} className="ui-dialog latex-picker" onClose={onClose}>
      <h2 className="ui-dialog-title m-0">{options.title}</h2>
      {problem !== null ? (
        <div className="latex-picker-note" role="alert">
          <p className="m-0">{problem}</p>
          <Button size="sm" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </div>
      ) : items === null ? (
        <p className="latex-picker-note m-0" role="status" aria-busy="true">
          Looking…
        </p>
      ) : nothingAtAll ? (
        <div className="latex-picker-note">
          <p className="m-0">{options.empty.text}</p>
          {options.empty.action && (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                options.empty.action?.run();
              }}
            >
              {options.empty.action.label}
            </Button>
          )}
        </div>
      ) : (
        <>
          <input
            className="ui-field"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="latex-picker-list"
            aria-activedescendant={shown[at] ? `latex-picker-${at}` : undefined}
            aria-label={options.placeholder}
            placeholder={options.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          {shown.length === 0 ? (
            <p className="latex-picker-note m-0" role="status">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul ref={list} id="latex-picker-list" className="latex-picker-list" role="listbox" aria-label={options.title}>
              {shown.map((item, n) => (
                <li
                  key={item.id}
                  id={`latex-picker-${n}`}
                  role="option"
                  aria-selected={n === at}
                  className={`latex-picker-row${n === at ? " is-active" : ""}`}
                  onMouseMove={() => setActive(n)}
                  onClick={() => pick(item)}
                >
                  <span className="latex-picker-label">{item.label}</span>
                  {item.detail && <span className="latex-picker-detail">{item.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

/** Opens a picker over the window. Answers how to close it from outside. */
export function openPicker(options: PickerOptions): () => void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // Unmounted after the current event, so the click that closed it finishes first.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  root.render(<Picker options={options} onClose={close} />);
  return close;
}
