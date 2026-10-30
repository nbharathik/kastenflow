// A message in a thread: the question as you typed it, or an answer with its
// text as Markdown and its tool calls as rows, in the order they streamed.
// Rows are memoised on the message, which the store replaces only while it
// streams, so a long thread does not redraw per token.

import "../message-edit.css";
import "../harness.css";

import { memo, useEffect, useState } from "react";

import { Working } from "../../../ui/BrandMark";
import { Icon } from "../../../ui/Icon";

import { copyToClipboard } from "../copy";
import { EDIT_QUESTION, type EditRequest } from "../edit-request";
import { Markdown } from "../markdown/Markdown";
import { useChat } from "../store";
import { isEmptyAnswer, type Answer, type Message, type Part, type UserMessage } from "../thread";
import { viewingEarlier } from "../thread-versions";
import { AnswerActions } from "./AnswerActions";
import { EmptyLine, FailureActions, PausedLine } from "./AnswerLines";
import { AttachmentStrip } from "./AttachmentStrip";
import { useChatLinks } from "./links";
import { ToolRun } from "./ToolRun";
import { clock, useElapsed } from "./use-elapsed";

export const MessageRow = memo(function MessageRow({ message, thread, contextShown, enters = false }: { message: Message; thread: string; contextShown: boolean; enters?: boolean }) {
  return message.role === "user" ? <Question message={message} thread={thread} contextShown={contextShown} enters={enters} /> : <AnswerView answer={message} thread={thread} enters={enters} />;
});

/** Whether the question with `id` can be asked another way: nothing is answering, the thread shows the
 * conversation the assistant remembers, and what follows it (if anything) is a finished answer. */
const editable = (thread: string, id: string) => (s: ReturnType<typeof useChat.getState>) => {
  const t = s.threads[thread];
  // While it streams this is answered without looking through the messages: every row asks, every frame.
  if (!t || t.streaming || t.stopping || viewingEarlier(t)) return false;
  const at = t.messages.findIndex((m) => m.id === id);
  const next = t.messages[at + 1];
  return at >= 0 && (!next || (next.role === "assistant" && next.status !== "streaming"));
};

function Question({ message, thread, contextShown, enters }: { message: UserMessage; thread: string; contextShown: boolean; enters: boolean }) {
  const can = useChat(editable(thread, message.id));
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // The up arrow in an empty message box asks for the newest question to open.
  useEffect(() => {
    const on = (event: Event) => {
      const wanted = (event as CustomEvent<EditRequest>).detail;
      if (wanted.thread === thread && wanted.message === message.id && editable(thread, message.id)(useChat.getState())) setEditing(true);
    };
    window.addEventListener(EDIT_QUESTION, on);
    return () => window.removeEventListener(EDIT_QUESTION, on);
  }, [thread, message.id]);
  if (editing && can) return <EditQuestion message={message.id} text={message.text} thread={thread} onDone={() => setEditing(false)} />;
  return (
    <div className={enters ? "kasten-chat-question is-entering" : "kasten-chat-question"}>
      {message.attachments && message.attachments.length > 0 && <AttachmentStrip items={message.attachments} />}
      <p className="kasten-chat-bubble">{message.text}</p>
      <div className="kasten-chat-question-tools">
        <button
          type="button"
          className="kasten-chat-edit"
          aria-label="Copy question"
          title="Copy this question"
          onClick={() => {
            void copyToClipboard(message.text).then((went) => {
              if (!went) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Icon name={copied ? "check" : "copy"} className="size-3.5" />
        </button>
        {can && (
          <button type="button" className="kasten-chat-edit" aria-label="Edit and resend" title="Edit this question and ask it again" onClick={() => setEditing(true)}>
            <Icon name="edit" className="size-3.5" />
          </button>
        )}
      </div>
      {contextShown && message.context.length > 0 && (
        <p className="kasten-chat-question-context" title="What this message was grounded in">
          {message.context.map((chip) => chip.label).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** A question as a field: Enter asks it again (in place of the old question and what followed it, which
 * stays as an earlier version), Escape leaves it as it was. */
function EditQuestion({ message, text, thread, onDone }: { message: string; text: string; thread: string; onDone: () => void }) {
  const [words, setWords] = useState(text);
  const send = async () => {
    if (!words.trim()) return;
    if (await useChat.getState().resendAt(thread, message, words)) onDone();
  };
  return (
    <form
      className="kasten-chat-question kasten-chat-editing"
      aria-label="Edit question"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        autoFocus
        rows={Math.min(8, Math.max(2, words.split("\n").length))}
        value={words}
        aria-label="Question"
        onChange={(event) => setWords(event.target.value)}
        onFocus={(event) => event.currentTarget.setSelectionRange(words.length, words.length)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <span className="kasten-chat-editing-actions">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={!words.trim()}>
          Send
        </button>
      </span>
    </form>
  );
}

type ToolPart = Extract<Part, { kind: "tool" }>;

/** The answer's parts with each unbroken run of tool calls gathered, so a long run can fold. */
function grouped(parts: Part[]): ({ part: Exclude<Part, { kind: "tool" }>; at: number } | { run: ToolPart[]; at: number })[] {
  const out: ReturnType<typeof grouped> = [];
  parts.forEach((part, at) => {
    const last = out[out.length - 1];
    if (part.kind !== "tool") out.push({ part, at });
    else if (last && "run" in last) last.run.push(part);
    else out.push({ run: [part], at });
  });
  return out;
}

/** The line under a working answer: how long it has worked, and the step it is on. */
function WorkingLine({ since, step }: { since: number | undefined; step: number | undefined }) {
  const seconds = useElapsed(since, true);
  return (
    <p className="kasten-chat-step">
      <span>Working · {clock(seconds)}</span>
      {step !== undefined && (
        <>
          {" · "}
          <span>Step {step}</span>
        </>
      )}
    </p>
  );
}

function AnswerView({ answer, thread, enters }: { answer: Answer; thread: string; enters: boolean }) {
  const links = useChatLinks();
  const streaming = answer.status === "streaming";
  // The step the model is on, said quietly while it works.
  const step = useChat((s) => (streaming ? s.threads[thread]?.round : undefined));
  return (
    <article className={enters ? "kasten-chat-answer is-entering" : "kasten-chat-answer"} aria-label="Answer" aria-busy={streaming}>
      {grouped(answer.parts).map((item) =>
        "run" in item ? (
          <ToolRun key={`run-${item.at}`} parts={item.run} live={streaming} />
        ) : item.part.kind === "text" ? (
          <Markdown key={item.at} text={item.part.text} onOpenTitle={links.openTitle} />
        ) : (
          // Something the person sent while it worked, where it took it up.
          <p key={item.at} className="kasten-chat-steer">
            <span>You</span> {item.part.text}
          </p>
        ),
      )}
      {streaming && answer.parts.length === 0 && (
        <p className="kasten-chat-thinking">
          <Working>Thinking</Working>
        </p>
      )}
      {streaming && answer.parts.length > 0 && <span className="kasten-chat-caret" aria-hidden="true" />}
      {streaming && <WorkingLine since={answer.startedAt} step={step} />}
      {answer.retry && (
        <p className="kasten-chat-retry" role="status">
          {answer.retry}
        </p>
      )}
      {answer.notice && (
        <p className="kasten-chat-notice" role="status">
          {answer.notice}
        </p>
      )}
      {answer.status === "stopped" && <p className="kasten-chat-status">Stopped</p>}
      {answer.status === "paused" && <PausedLine answer={answer} thread={thread} />}
      {isEmptyAnswer(answer) && <EmptyLine answer={answer} thread={thread} />}
      {answer.status === "error" && (
        <>
          <p className="kasten-chat-error" role="alert">
            {answer.error}
          </p>
          <FailureActions answer={answer} thread={thread} />
        </>
      )}
      {!streaming && <AnswerActions answer={answer} thread={thread} />}
    </article>
  );
}
