// What can be done with a finished answer: the model and steps it took, the
// versions it has ("‹ 2 / 3 ›"), copy as words or as Markdown, ask again, pin
// as a card.

import { useEffect, useRef, useState, type MouseEvent } from "react";

import { howFrom, useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { pinAnswer } from "../actions";
import { copyToClipboard, plainAnswer } from "../copy";
import { useChat } from "../store";
import { answerText, type Answer } from "../thread";
import { versionsOf, viewingEarlier } from "../thread-versions";
import { useChatLinks } from "./links";

/** Which version button the person pressed: the switcher of the answer now shown is a new one, and takes the focus. */
let refocus: "previous" | "next" | null = null;

function Versions({ answer, thread }: { answer: Answer; thread: string }) {
  const key = useChat((s) => {
    const t = s.threads[thread];
    const found = t && versionsOf(t, answer.id);
    return found ? `${found.at}:${found.shown}:${found.total}` : "";
  });
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!refocus) return;
    const order = refocus === "previous" ? [previous.current, next.current] : [next.current, previous.current];
    refocus = null;
    // The button pressed, or the other when the end was reached.
    order.find((button) => button && !button.disabled)?.focus();
  }, []);
  if (!key) return null;
  const [at, shown, total] = key.split(":").map(Number) as [number, number, number];
  const go = (to: number, which: "previous" | "next") => {
    refocus = which;
    useChat.getState().showVersion(thread, at, to);
  };
  return (
    <span className="kasten-chat-versions" role="group" aria-label="Versions of this answer">
      <button ref={previous} type="button" aria-label="Previous version" disabled={shown === 0} onClick={() => go(shown - 1, "previous")}>
        ‹
      </button>
      <span aria-live="polite">
        {shown + 1} / {total}
      </span>
      <button ref={next} type="button" aria-label="Next version" disabled={shown === total - 1} onClick={() => go(shown + 1, "next")}>
        ›
      </button>
    </span>
  );
}

export function AnswerActions({ answer, thread }: { answer: Answer; thread: string }) {
  const links = useChatLinks();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"plain" | "markdown" | null>(null);
  const pinned = useWorkspace((s) => (answer.pinned ? noteAt(s.notes, answer.pinned) : undefined));
  // Only the newest answer can be asked again: that asks the newest question.
  const newest = useChat((s) => {
    const messages = s.threads[thread]?.messages;
    return messages?.[messages.length - 1]?.id === answer.id;
  });
  const earlier = useChat((s) => Boolean(s.threads[thread] && viewingEarlier(s.threads[thread])));
  const text = answerText(answer);
  const steps = answer.parts.filter((p) => p.kind === "tool").length;
  const pin = async () => {
    setBusy(true);
    await pinAnswer(thread, answer, "here");
    setBusy(false);
  };
  const copy = async (as: "plain" | "markdown") => {
    if (!(await copyToClipboard(as === "plain" ? plainAnswer(answer) : text))) return;
    setCopied(as);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="kasten-chat-actions">
      <span className="kasten-chat-model-used" title={`${answer.provider} · ${answer.model}`}>
        {answer.model}
        {steps > 0 && ` · ${steps} ${steps === 1 ? "step" : "steps"}`}
      </span>
      <Versions answer={answer} thread={thread} />
      {text && (
        <>
          <button type="button" onClick={() => void copy("plain")}>
            {copied === "plain" ? "Copied" : "Copy"}
          </button>
          <button type="button" title="Copy with its Markdown marks" onClick={() => void copy("markdown")}>
            {copied === "markdown" ? "Copied" : "Copy as Markdown"}
          </button>
        </>
      )}
      {newest && !earlier && answer.status !== "error" && (
        <button type="button" title="Ask the question again and replace this answer" onClick={() => void useChat.getState().regenerate(thread)}>
          Regenerate
        </button>
      )}
      {pinned ? (
        <button type="button" onClick={(event: MouseEvent) => links.openPath(pinned.path, howFrom(event))} title={`Open “${pinned.title}”`}>
          Pinned · Open card
        </button>
      ) : (
        text && (
          <button type="button" disabled={busy} onClick={() => void pin()}>
            {busy ? "Pinning…" : "Pin as card"}
          </button>
        )
      )}
    </div>
  );
}
