// The provider and model a thread answers with. A provider comes with its
// own model; any other can be typed, such as a model a vLLM server serves.

import { useRef, useState } from "react";

import { Popup } from "../../pages/page/Popup";
import { openProviders } from "../actions";
import { modelFor } from "../prefs";
import { useChat } from "../store";
import type { Thread } from "../thread";
import type { ChatKind } from "../types";
import { Icon } from "../../../ui/Icon";

export const KIND_LABELS: Record<ChatKind, string> = { anthropic: "Anthropic", openai: "OpenAI-compatible", chatgpt: "ChatGPT plan" };

export function ModelPicker({ thread }: { thread: Thread }) {
  const providers = useChat((s) => s.providers);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const choice = modelFor(thread, providers);
  if (!providers?.length || !choice) return null;
  const provider = providers.find((p) => p.name === choice.provider)!;

  return (
    <span className="kasten-chat-model">
      <button
        ref={button}
        type="button"
        className="kasten-chat-model-button"
        aria-label={`Model: ${choice.provider}, ${choice.model}`}
        aria-expanded={open}
        title={`${choice.provider} · ${choice.model}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="kasten-chat-model-provider">{choice.provider}</span>
        <span className="kasten-chat-model-name">{choice.model}</span>
        <Icon name="chevron-down" className="size-3.5" />
      </button>
      {open && (
        <Popup label="Provider and model" anchor={button} onClose={() => setOpen(false)} className="kasten-chat-model-menu">
          <div role="radiogroup" aria-label="Provider">
            {providers.map((p) => (
              <button
                key={p.name}
                type="button"
                role="radio"
                aria-checked={p.name === choice.provider}
                onClick={() => useChat.getState().choose(thread.id, p.name, null)}
              >
                <span className="kasten-chat-model-provider">{p.name}</span>
                <small>
                  {KIND_LABELS[p.kind]} · {p.model}
                </small>
              </button>
            ))}
          </div>
          <ModelField key={`${choice.provider}|${choice.model}`} value={choice.model} fallback={provider.model} onDone={(model) => useChat.getState().choose(thread.id, choice.provider, model)} />
          <button
            type="button"
            className="kasten-chat-model-manage"
            onClick={() => {
              setOpen(false);
              openProviders("here");
            }}
          >
            Manage AI providers…
          </button>
        </Popup>
      )}
    </span>
  );
}

/** The model's name, typed; empty goes back to the provider's own. */
function ModelField({ value, fallback, onDone }: { value: string; fallback: string; onDone: (model: string | null) => void }) {
  const [text, setText] = useState(value);
  const done = () => onDone(text.trim() && text.trim() !== fallback ? text.trim() : null);
  return (
    <label className="kasten-chat-model-field">
      <span>Model</span>
      <input
        value={text}
        placeholder={fallback}
        aria-label="Model"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          done();
        }}
      />
    </label>
  );
}
