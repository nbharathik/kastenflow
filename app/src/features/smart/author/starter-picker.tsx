// A small list of the starters (and the person's own templates), opened where
// the person is: the first is ready to take with Enter, arrows move, a click
// chooses, Escape leaves. Used to start a smart page from the palette or "/smart", and to
// pick what an ordinary page becomes. Mounted on demand.

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import { type AuthorBackend, type StarterInfo, sentence, tauriAuthorBackend } from "./backend";
import { newSmartPage, turnIntoSmartPage } from "./flows";
import { STARTERS_TITLE, TURN_INTO_TITLE } from "./words";
import "./picker.css";

export interface ChooseOptions {
  /** Turn this page into a smart page instead of making a new one. */
  turnInto?: string;
  onDone?(): void;
  backend?: AuthorBackend;
}

function Picker({ options, onClose }: { options: ChooseOptions; onClose: () => void }) {
  const backend = options.backend ?? tauriAuthorBackend;
  const [items, setItems] = useState<StarterInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const title = options.turnInto ? TURN_INTO_TITLE : STARTERS_TITLE;

  useEffect(() => {
    let live = true;
    setItems(null);
    setProblem(null);
    backend.starters().then(
      (found) => live && setItems(found),
      (err: unknown) => live && setProblem(sentence(err)),
    );
    return () => {
      live = false;
    };
  }, [backend, attempt]);

  const pick = (item: StarterInfo) => {
    onClose();
    if (options.turnInto) void turnIntoSmartPage(options.turnInto, item.id, options.backend).then((done) => done && options.onDone?.());
    else void newSmartPage(item.id, options.backend).then(() => options.onDone?.());
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), buttons.length - 1)];
    event.preventDefault();
    next?.focus();
  };

  return (
    <Modal label={title} className="ui-dialog smart-picker" onClose={onClose}>
      <h2 className="ui-dialog-title m-0">{title}</h2>
      {problem !== null ? (
        <div className="smart-picker-note" role="alert">
          <p className="m-0">{problem}</p>
          <Button size="sm" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </div>
      ) : items === null ? (
        <p className="smart-picker-note m-0" role="status" aria-busy="true">
          Looking…
        </p>
      ) : (
        <ul ref={list} className="smart-picker-list" aria-label={title} onKeyDown={onKey}>
          {items.map((item, n) => (
            <li key={item.id}>
              <button type="button" className="smart-picker-row" autoFocus={n === 0} onClick={() => pick(item)}>
                <span className="smart-picker-label">{item.name}</span>
                <span className="smart-picker-detail">{item.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Opens the list over the window; answers how to close it from outside. */
export function chooseStarter(options: ChooseOptions = {}): () => void {
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
