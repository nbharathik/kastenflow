// The brainstorm's form above the board's bar: what the ideas are about,
// how many, and which AI provider thinks of them. Without a provider it
// says where to add one.

import { useReactFlow } from "@xyflow/react";
import { useEffect, useId, useMemo, useState } from "react";

import { motionMs } from "../../../lib/motion";
import { openProviders } from "../../chat/actions";
import { keepModel, lastModel, modelFor } from "../../chat/prefs";
import { useChat } from "../../chat/store";
import type { ChatProvider } from "../../chat/types";
import { useBoard } from "../canvas/context";
import { BrandMark } from "../../../ui/BrandMark";
import { ToolIcon } from "../canvas/toolbar/icons";
import { brainstorm, dismissError, formOpened, useBrainstorms } from "./run";

import "./brainstorm.css";

const COUNTS = [4, 8, 12, 16, 20];
const FIRST_COUNT = 8;
/** The model to use with `provider`: the last one used with it, else its own. */
const modelOf = (provider: ChatProvider) => {
  const last = lastModel();
  return last?.provider === provider.name && last.model.trim() ? last.model.trim() : provider.model;
};

export function BrainstormForm({ onClose }: { onClose: () => void }) {
  const board = useBoard();
  const flow = useReactFlow();
  const everything = useChat((s) => s.providers);
  // A brainstorm asks a model; the coding agents are not offered for it.
  const providers = useMemo(() => everything?.filter((p) => p.kind !== "cli") ?? null, [everything]);
  const providersError = useChat((s) => s.providersError);
  const preview = useChat((s) => s.client?.kind === "preview");
  const running = useBrainstorms((s) => Boolean(s.running[board.path]));
  const error = useBrainstorms((s) => s.errors[board.path] ?? null);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(FIRST_COUNT);
  const [chosen, setChosen] = useState<string | null>(null);
  const ids = useId();

  useEffect(() => {
    return formOpened(board.path);
  }, [board.path]);
  useEffect(() => {
    if (useChat.getState().providers === null) void useChat.getState().loadProviders();
  }, []);

  // The one picked here while it exists, else the one chats start with.
  const initial = modelFor({ provider: chosen, model: null }, providers);
  const provider = providers?.find((p) => p.name === initial?.provider) ?? null;

  if (providers === null) return <p className="kasten-brainstorm-note">Reading your AI providers…</p>;
  if (!provider) {
    return (
      <div className="kasten-brainstorm is-empty">
        <Heading />
        <p>{providersError ? `The AI providers could not be read: ${providersError}` : "A brainstorm needs an AI provider: the Anthropic API, or any OpenAI-compatible server such as vLLM."}</p>
        <button
          type="button"
          className="kasten-brainstorm-go"
          onClick={() => {
            onClose();
            openProviders("tab");
          }}
        >
          Set up in Settings → AI providers
        </button>
      </div>
    );
  }

  const model = modelOf(provider);
  const reveal = (section: string) => revealWhenShown(flow, section);
  const submit = () => {
    if (running) return;
    keepModel({ provider: provider.name, model });
    void brainstorm(board, { topic: topic.trim(), count, provider: provider.name, model }, reveal).then((done) => done && onClose());
  };

  return (
    <form
      className="kasten-brainstorm"
      aria-busy={running}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Heading />
      <label className="kasten-brainstorm-field">
        <span>Ideas about</span>
        <input
          autoFocus
          value={topic}
          disabled={running}
          onChange={(e) => {
            setTopic(e.target.value);
            if (error) dismissError(board.path);
          }}
          placeholder="Leave empty for whatever moves this board on"
          aria-label="Ideas about"
        />
      </label>
      <div className="kasten-brainstorm-row">
        <span id={`${ids}-count`}>How many</span>
        <div className="kasten-brainstorm-counts" role="radiogroup" aria-labelledby={`${ids}-count`}>
          {COUNTS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={n === count} disabled={running} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className="kasten-brainstorm-row">
        <span>Model</span>
        <select value={provider.name} disabled={running} onChange={(e) => setChosen(e.target.value)} aria-label="AI provider" title={`${provider.name} · ${model}`}>
          {providers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} · {modelOf(p)}
            </option>
          ))}
        </select>
      </label>
      {preview && <p className="kasten-brainstorm-note">The browser preview places canned ideas. In the app, the model you pick writes them.</p>}
      {error && (
        <p className="kasten-brainstorm-error" role="alert">
          {error}
        </p>
      )}
      <div className="kasten-brainstorm-foot">
        <span className="kasten-brainstorm-note">New cards in a new section, all undone in one step.</span>
        <button type="submit" className="kasten-brainstorm-go" disabled={running}>
          {running ? (
            <>
              <BrandMark working className="size-[14px]" />
              Thinking…
            </>
          ) : (
            "Brainstorm"
          )}
        </button>
      </div>
    </form>
  );
}

function Heading() {
  return (
    <p className="kasten-brainstorm-title">
      <ToolIcon name="spark" className="size-4" />
      Brainstorm on this board
    </p>
  );
}

type Flow = ReturnType<typeof useReactFlow>;

/** Moves the view to `section` once the board draws it: the reload that
 * brings it may take a frame or two. */
function revealWhenShown(flow: Flow, section: string, frames = 30): void {
  try {
    if (flow.getNode(section)) {
      void flow.fitView({ nodes: [{ id: section }], padding: 0.2, duration: motionMs(450), maxZoom: 1 });
      return;
    }
  } catch {
    return; // The board has closed.
  }
  if (frames > 0) requestAnimationFrame(() => revealWhenShown(flow, section, frames - 1));
}
