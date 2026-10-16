// The model of a thread: what the provider lists, filtered as you type. The
// field still takes any name, such as a model a vLLM server serves that its
// list leaves out: Enter uses what was typed, or the listed model the arrow
// keys stopped on.

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useChat } from "../store";
import type { ChatProvider } from "../types";

/** The most models drawn at once; typing narrows the rest. */
const SHOWN = 80;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface ModelListProps {
  provider: ChatProvider;
  /** The model in use. */
  value: string;
  /** The provider's own model, which choosing means "no choice of my own". */
  fallback: string;
  /** The chosen model; null for the provider's own. */
  onPick: (model: string | null) => void;
}

export function ModelList({ provider, value, fallback, onPick }: ModelListProps) {
  const listId = useId();
  // Null while the provider is asked.
  const [models, setModels] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [text, setText] = useState(value);
  // What is typed filters; the model in use does not, before any typing.
  const [typed, setTyped] = useState(false);
  const [at, setAt] = useState(-1);

  useEffect(() => {
    let live = true;
    setModels(null);
    setProblem(null);
    // The saved provider with no key typed: the backend asks with the key kept for it.
    const draft = { name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, model: provider.model };
    useChat
      .getState()
      .ensure()
      .listProviderModels(draft, null)
      .then(
        (list) => live && setModels(list),
        (err) => {
          if (!live) return;
          setModels([]);
          setProblem(message(err));
        },
      );
    return () => {
      live = false;
    };
  }, [provider.name, provider.kind, provider.baseUrl, provider.model]);

  const shown = useMemo(() => {
    const needle = typed ? text.trim().toLowerCase() : "";
    const matching = needle ? (models ?? []).filter((m) => m.toLowerCase().includes(needle)) : (models ?? []);
    return matching.slice(0, SHOWN);
  }, [models, text, typed]);

  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // jsdom has no scrolling.
    list.current?.querySelector("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  const pick = (model: string) => onPick(model === fallback ? null : model);
  const typedName = () => onPick(text.trim() && text.trim() !== fallback ? text.trim() : null);

  return (
    <div className="kasten-chat-models">
      <label className="kasten-chat-model-field">
        <span>Model</span>
        <input
          value={text}
          placeholder={fallback}
          aria-label="Model"
          aria-controls={listId}
          aria-autocomplete="list"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setTyped(true);
            setAt(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (shown.length === 0) return;
              e.preventDefault();
              // Through the models, and the typed text before the first.
              const next = at + (e.key === "ArrowDown" ? 1 : -1);
              setAt(next < -1 ? shown.length - 1 : next >= shown.length ? -1 : next);
              return;
            }
            if (e.key !== "Enter") return;
            e.preventDefault();
            const chosen = shown[at];
            if (chosen) pick(chosen);
            else typedName();
          }}
        />
      </label>
      {models === null && (
        <p className="kasten-chat-model-note" role="status">
          Loading models…
        </p>
      )}
      {problem && (
        <p className="kasten-chat-model-note" role="status">
          The model list could not be read ({problem}). Type the model's name.
        </p>
      )}
      <ul ref={list} id={listId} role="listbox" aria-label="Models" className="kasten-chat-model-list" hidden={shown.length === 0}>
        {shown.map((model, i) => (
          // Mouse down keeps the focus in the field, so choosing never blurs it first.
          <li key={model} role="option" aria-selected={model === value} data-active={i === at ? "" : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(model)}>
            {model}
          </li>
        ))}
      </ul>
      {models !== null && models.length > 0 && shown.length === 0 && typed && (
        <p className="kasten-chat-model-note" role="status">
          No listed model matches. Enter uses “{text.trim()}”.
        </p>
      )}
    </div>
  );
}
