// The AI panel in a page, below the text it is about. "Ask AI" takes what
// to do, typed or picked; "Continue writing" and "Summarize page" start at
// once. The answer streams into a preview and the page stays as it is
// until Replace or Insert, one change that Mod+Z takes back, saved as the
// person's own edit. Escape or Discard leaves the page untouched.
//
// "Explain" and the AI actions that write nothing are answers to read: they
// can be copied or carried on in the chat, and never put in the page.
// Actions that write offer Replace and Insert like Ask AI does.

import "./ai.css";

import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "../../../../ui/Button";
import { Icon } from "../../../../ui/Icon";
import { openProviders } from "../../../chat/actions";
import { Markdown } from "../../../chat/markdown/Markdown";
import { modelFor } from "../../../chat/prefs";
import { runInChat } from "../../../chat/run-action";
import { useChat } from "../../../chat/store";
import type { ActionRun, AiAction, ExplainScope, WriteAction } from "../../../chat/types";
import { aiRange, closingAi, type AiOpen, type AiRange } from "./ai";
import { ActionRow, iconOf } from "./ActionRow";
import { continueInChat, copyAnswer, pageChip, pageFacts } from "./explain";
import { cleanAnswer, pageText, placeAnswer, wholePage, type Placing } from "./place";
import { useAnswer } from "./useAnswer";

interface Props {
  view: EditorView;
  open: AiOpen;
  /** The page's title, sent with it. */
  title: string;
  /** Markdown to the editor's content, and back. */
  parse(markdown: string): Node | null;
  serialize(doc: Node): string;
  onClose(): void;
}

/** What the panel is doing: one of the editor's own actions, or an AI action. */
type Kind = WriteAction | "action";

const TITLES: Record<WriteAction, string> = { ask: "Ask AI", continue: "Continue writing", summarize: "Summarize page", explain: "Explain" };
const ON_TEXT = ["Improve the writing", "Make it shorter", "Fix spelling and grammar", "Turn it into a list"];
const AT_CARET = ["Brainstorm ideas", "Draft an outline", "Write a to-do list"];
const SCOPES: { scope: ExplainScope; label: string }[] = [
  { scope: "nearby", label: "Nearby text" },
  { scope: "page", label: "Whole page" },
];

const noLinks = () => {};

export function AiPanel({ view, open, title, parse, serialize, onClose }: Props) {
  const providers = useChat((s) => s.providers);
  const [kind, setKind] = useState<Kind>(open.slug && open.slug !== "explain" ? "action" : open.slug === "explain" ? "explain" : open.action);
  const [action, setAction] = useState<AiAction | null>(null);
  const [scope, setScope] = useState<ExplainScope>("nearby");
  const [instruction, setInstruction] = useState("");
  const [asked, setAsked] = useState("");
  const answer = useAnswer(open.action === "ask" && !open.slug ? "asking" : "writing");
  const { phase, text, note, error } = answer;
  const input = useRef<HTMLInputElement>(null);
  const [chosen] = useState(() => {
    const range = aiRange(view.state);
    return Boolean(range && range.to > range.from);
  });
  const choice = modelFor({ provider: null, model: null }, providers);
  const client = () => useChat.getState().ensure();

  /** What an AI action is run with: only what it asks for. */
  const runFor = (picked: AiAction, id: string, pick: { provider: string; model: string }, range: AiRange, extra: string): ActionRun => {
    const wants = new Set([...picked.needs, ...picked.optional]);
    const around = pageText(view.state.doc, "ask", range, serialize);
    const facts = pageFacts();
    return {
      id,
      action: picked.slug,
      provider: pick.provider,
      model: pick.model,
      title,
      ...(extra ? { instruction: extra } : {}),
      ...(wants.has("selection") ? { selection: around.selection } : {}),
      ...(wants.has("nearby") ? { before: around.before, after: around.after } : {}),
      ...(wants.has("page") ? { page: wholePage(view.state.doc, serialize) } : {}),
      ...(wants.has("project") && facts.project ? { project: facts.project } : {}),
      ...(wants.has("journal") ? { date: facts.date } : {}),
    };
  };

  /** An action that proposes a change is a chat about this page that previews
   * its changes: what it changes waits as staged changes for the person to
   * review, and nothing is put in the page from here. */
  const proposeInChat = (picked: AiAction) => {
    const range = aiRange(view.state);
    const passage = range ? pageText(view.state.doc, "ask", range, serialize).selection : "";
    const chip = pageChip();
    onClose();
    void runInChat(picked.slug, chip ? [chip] : [], passage);
  };

  /** Asks for an answer in `how`: the editor's own action, or an AI action. */
  const begin = async (how: { kind: Kind; action?: AiAction | null; scope?: ExplainScope; asking?: string }) => {
    const range = aiRange(view.state);
    if (!range) return onClose();
    const pick = modelFor({ provider: null, model: null }, useChat.getState().providers);
    if (!pick) return answer.setPhase("setup");
    setAsked(how.asking ?? "");
    await answer.start((id, onText) => {
      if (how.kind === "action") {
        if (!how.action) throw new Error("There is no such AI action");
        return client().runAction(runFor(how.action, id, pick, range, how.asking ?? ""), onText);
      }
      const page = pageText(view.state.doc, how.kind, range, serialize, how.scope);
      const explaining = how.kind === "explain";
      return client().write({ id, provider: pick.provider, model: pick.model, action: how.kind, instruction: how.asking ?? "", title, ...page, ...(explaining ? { scope: how.scope ?? "nearby" } : {}) }, onText);
    });
  };

  // Opening: the actions that need no words start at once; Ask AI waits for them.
  useEffect(() => {
    let gone = false;
    void (async () => {
      if (useChat.getState().providers === null) await useChat.getState().loadProviders();
      if (gone) return;
      if (open.slug && open.slug !== "explain") {
        const found = (await client().aiActions().catch(() => null))?.actions.find((a) => a.slug === open.slug) ?? null;
        if (gone) return;
        if (found?.writes === "propose") return proposeInChat(found);
        setAction(found);
        void begin({ kind: "action", action: found });
      } else if (kind !== "ask") void begin({ kind, scope });
      else if (!modelFor({ provider: null, model: null }, useChat.getState().providers)) answer.setPhase("setup");
      else input.current?.focus();
    })();
    return () => {
      gone = true;
      answer.abandon();
    };
    // Once per opening: the panel is keyed by it.
  }, []);

  const accept = (how: Placing) => {
    const range = aiRange(view.state);
    const doc = parse(cleanAnswer(text));
    if (!range || !doc || doc.childCount === 0) return answer.setError("This answer could not be put in the page.");
    view.dispatch(closingAi(placeAnswer(view.state, doc.content, range, how)));
    view.focus();
    onClose();
  };
  const discard = () => {
    answer.abandon();
    onClose();
    view.focus();
  };
  const ask = (what: string) => {
    const wanted = what.trim();
    if (wanted) void begin({ kind: "ask", asking: wanted });
  };
  /** An action picked from the row: Explain keeps its own request, the rest are run. */
  const pick = (picked: AiAction) => {
    if (picked.slug === "explain") {
      setKind("explain");
      void begin({ kind: "explain", scope });
      return;
    }
    if (picked.writes === "propose") return proposeInChat(picked);
    setKind("action");
    setAction(picked);
    void begin({ kind: "action", action: picked });
  };
  const switchScope = (next: ExplainScope) => {
    if (next === scope) return;
    setScope(next);
    void begin({ kind: "explain", scope: next });
  };

  const readOnly = kind === "explain" || (kind === "action" && action?.writes === "none");
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      discard();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && phase === "done" && !readOnly) {
      event.preventDefault();
      accept(chosen ? "replace" : "below");
    }
  };
  const again = () => void begin({ kind, action, scope, asking: kind === "ask" ? instruction.trim() || asked : "" });
  const carryOver = () => {
    const range = aiRange(view.state);
    const passage = range ? pageText(view.state.doc, "ask", range, serialize).selection : "";
    continueInChat({ title, passage, answer: cleanAnswer(text) });
    discard();
  };

  const answered = phase === "done" || phase === "failed";
  const preview = client().kind === "preview";
  const heading = kind === "action" ? (action?.title ?? "AI action") : TITLES[kind];
  return (
    <div className="kasten-ai" role="dialog" aria-label={heading} onKeyDown={onKey}>
      <div className="kasten-ai-head">
        <Icon name={kind === "action" && action ? iconOf(action) : kind === "explain" ? "bulb" : "sparkle"} className="kasten-ai-mark" />
        {kind === "ask" ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              ask(instruction);
            }}
          >
            <input
              ref={input}
              className="kasten-ai-input"
              value={instruction}
              aria-label="Ask AI"
              placeholder={chosen ? "Tell AI what to do with the selection…" : "Ask AI to write…"}
              readOnly={phase === "writing"}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </form>
        ) : (
          <span className="kasten-ai-title">{heading}</span>
        )}
        {phase === "writing" && (
          <Button size="sm" icon="stop" onClick={answer.stop}>
            Stop
          </Button>
        )}
      </div>
      {kind === "ask" && phase === "asking" && !instruction && (
        <>
          <div className="kasten-ai-quick">
            {(chosen ? ON_TEXT : AT_CARET).map((quick) => (
              <button
                key={quick}
                type="button"
                className="kasten-ai-chip"
                onClick={() => {
                  setInstruction(quick);
                  ask(quick);
                }}
              >
                {quick}
              </button>
            ))}
          </div>
          <ActionRow have={{ selection: chosen, project: Boolean(pageFacts().project) }} onPick={pick} />
        </>
      )}
      {kind === "explain" && phase !== "setup" && (
        <div className="kasten-ai-scope" role="group" aria-label="Text to read">
          {SCOPES.map(({ scope: value, label }) => (
            <button key={value} type="button" className="kasten-ai-chip" aria-pressed={scope === value} onClick={() => switchScope(value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {(phase === "writing" || text) && (
        <div className="kasten-ai-preview" aria-label="AI's answer" aria-busy={phase === "writing"}>
          {text ? <Markdown text={cleanAnswer(text)} onOpenTitle={noLinks} /> : <span className="text-muted">{readOnly ? "Reading…" : "Writing…"}</span>}
        </div>
      )}
      {note && <p className="kasten-ai-note">{note}</p>}
      {error && (
        <p role="alert" className="kasten-ai-error">
          {error}
        </p>
      )}
      {phase === "setup" && (
        <div className="kasten-ai-quick items-center">
          <span className="text-13 text-muted">Add an AI provider in Settings to write with AI.</span>
          <Button size="sm" onClick={() => openProviders()}>
            Set up AI
          </Button>
        </div>
      )}
      <div className="kasten-ai-foot">
        <span className="kasten-ai-via" title={preview ? "The browser preview writes canned text" : undefined}>
          {choice && `${choice.provider} · ${choice.model}`}
        </span>
        {phase === "done" &&
          (readOnly ? (
            <>
              <Button size="sm" onClick={() => void copyAnswer(cleanAnswer(text))}>
                Copy
              </Button>
              <Button size="sm" tone="primary" onClick={carryOver}>
                Continue in chat
              </Button>
            </>
          ) : chosen ? (
            <>
              <Button size="sm" tone="primary" onClick={() => accept("replace")}>
                Replace selection
              </Button>
              <Button size="sm" onClick={() => accept("below")}>
                Insert below
              </Button>
            </>
          ) : (
            <Button size="sm" tone="primary" onClick={() => accept("below")}>
              Insert
            </Button>
          ))}
        {answered && (
          <Button size="sm" onClick={again}>
            Try again
          </Button>
        )}
        <Button size="sm" tone="quiet" onClick={discard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
