// The provider and model a thread answers with. A provider comes with its
// own model; the model is picked from what the provider lists, or typed, such
// as a model a vLLM server serves. Beside it, the generation settings the
// model takes (AdvancedPopover).

import { useEffect, useRef, useState } from "react";

import { Popup } from "../../pages/page/Popup";
import { openAgents, openProviders } from "../actions";
import { isAgentProvider } from "../agents/names";
import { chatModelFor } from "../prefs";
import { useChat } from "../store";
import type { ComposerThread } from "../thread";
import type { ChatKind } from "../types";
import { Icon } from "../../../ui/Icon";
import { AdvancedPopover } from "./AdvancedPopover";
import { ModelList } from "./ModelList";

export const KIND_LABELS: Record<ChatKind, string> = { anthropic: "Anthropic", openai: "OpenAI-compatible", chatgpt: "ChatGPT plan", cli: "Coding agent" };

/** Asks the model picker of a thread to open, as a failed answer's "Choose
 * model" does. */
const CHOOSE = "kasten:choose-model";
export const chooseModel = (thread: string) => window.dispatchEvent(new CustomEvent<string>(CHOOSE, { detail: thread }));

export function ModelPicker({ thread }: { thread: ComposerThread }) {
  const providers = useChat((s) => s.providers);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const choice = chatModelFor(thread, providers);
  useEffect(() => {
    const ask = (event: Event) => {
      if ((event as CustomEvent<string>).detail === thread.id) setOpen(true);
    };
    window.addEventListener(CHOOSE, ask);
    return () => window.removeEventListener(CHOOSE, ask);
  }, [thread.id]);
  if (!providers?.length || !choice) return null;
  const provider = providers.find((p) => p.name === choice.provider)!;
  // A coding agent has no model list or settings here: it uses its own account, model and limits.
  const agent = isAgentProvider(choice.provider);

  return (
    <span className="kasten-chat-model">
      <button
        ref={button}
        type="button"
        className="kasten-chat-model-button"
        aria-label={agent ? `Agent: ${choice.provider}` : `Model: ${choice.provider}, ${choice.model}`}
        aria-expanded={open}
        title={agent ? choice.provider : `${choice.provider} · ${choice.model}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="kasten-chat-model-provider">{choice.provider}</span>
        {!agent && <span className="kasten-chat-model-name">{choice.model}</span>}
        <Icon name="chevron-down" className="size-3.5" />
      </button>
      {!agent && <AdvancedPopover thread={thread} choice={choice} />}
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
                <small>{isAgentProvider(p.name) ? (p.hasKey ? "Coding agent · your own account" : "Coding agent · not installed") : `${KIND_LABELS[p.kind]} · ${p.model}`}</small>
              </button>
            ))}
          </div>
          {agent ? (
            <p className="kasten-chat-agent-note">{provider.hasKey ? "Answers with the program on this computer, using its own account, model and limits. It asks before it does anything but use your notes." : "Not found on this computer. Open Agents in Settings for how to install it."}</p>
          ) : (
            <ModelList
              key={`${choice.provider}|${choice.model}`}
              provider={provider}
              value={choice.model}
              fallback={provider.model}
              onPick={(model) => {
                useChat.getState().choose(thread.id, choice.provider, model);
                setOpen(false);
              }}
            />
          )}
          <button
            type="button"
            className="kasten-chat-model-manage"
            onClick={() => {
              setOpen(false);
              if (agent) openAgents("here");
              else openProviders("here");
            }}
          >
            {agent ? "Manage coding agents…" : "Manage AI providers…"}
          </button>
        </Popup>
      )}
    </span>
  );
}
