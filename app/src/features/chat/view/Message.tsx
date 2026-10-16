// A message in a thread: the question as you typed it, or an answer with its
// text as Markdown and its tool calls as rows, in the order they streamed.
// Rows are memoised on the message, which the store replaces only while it
// streams, so a long thread does not redraw per token.

import "../message-edit.css";
import "../harness.css";

import { memo, useState, type MouseEvent } from "react";

import { Working } from "../../../ui/BrandMark";
import { Icon } from "../../../ui/Icon";

import { howFrom, useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { openProviders, pinAnswer } from "../actions";
import { Markdown } from "../markdown/Markdown";
import { useChat } from "../store";
import { answerText, type Answer, type Message, type UserMessage } from "../thread";
import { AttachmentStrip } from "./AttachmentStrip";
import { ToolRow } from "./ToolRow";
import { chooseModel } from "./ModelPicker";
import { useChatLinks } from "./links";

export const MessageRow = memo(function MessageRow({ message, thread, contextShown }: { message: Message; thread: string; contextShown: boolean }) {
  return message.role === "user" ? <Question message={message} thread={thread} contextShown={contextShown} /> : <AnswerView answer={message} thread={thread} />;
});

/** Whether `id` is the newest message of the thread but one, with nothing
 * answering: the newest question, which can still be asked another way. */
const askedLast = (thread: string, id: string) => (s: ReturnType<typeof useChat.getState>) => {
  const t = s.threads[thread];
  return Boolean(t && !t.streaming && t.messages.length >= 2 && t.messages[t.messages.length - 2]?.id === id);
};

function Question({ message, thread, contextShown }: { message: UserMessage; thread: string; contextShown: boolean }) {
  const editable = useChat(askedLast(thread, message.id));
  const [editing, setEditing] = useState(false);
  if (editing && editable) return <EditQuestion text={message.text} thread={thread} onDone={() => setEditing(false)} />;
  return (
    <div className="kasten-chat-question">
      {message.attachments && message.attachments.length > 0 && <AttachmentStrip items={message.attachments} />}
      <p className="kasten-chat-bubble">{message.text}</p>
      {editable && (
        <button type="button" className="kasten-chat-edit" aria-label="Edit and resend" title="Edit this question and ask it again" onClick={() => setEditing(true)}>
          <Icon name="edit" className="size-3.5" />
        </button>
      )}
      {contextShown && message.context.length > 0 && (
        <p className="kasten-chat-question-context" title="What this message was grounded in">
          {message.context.map((chip) => chip.label).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** The newest question as a field: Enter asks it again (in place of the old
 * question and its answer), Escape leaves it as it was. */
function EditQuestion({ text, thread, onDone }: { text: string; thread: string; onDone: () => void }) {
  const [words, setWords] = useState(text);
  const send = async () => {
    if (!words.trim()) return;
    if (await useChat.getState().resend(thread, words)) onDone();
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

function AnswerView({ answer, thread }: { answer: Answer; thread: string }) {
  const links = useChatLinks();
  const streaming = answer.status === "streaming";
  // The step the model is on, said quietly while it works.
  const step = useChat((s) => (streaming ? s.threads[thread]?.round : undefined));
  return (
    <article className="kasten-chat-answer" aria-label="Answer" aria-busy={streaming}>
      {answer.parts.map((part, i) =>
        part.kind === "text" ? (
          <Markdown key={i} text={part.text} onOpenTitle={links.openTitle} />
        ) : part.kind === "tool" ? (
          <ToolRow key={part.call.id || i} part={part} live={streaming} />
        ) : (
          // Something the person sent while it worked, where it took it up.
          <p key={i} className="kasten-chat-steer">
            <span>You</span> {part.text}
          </p>
        ),
      )}
      {streaming && answer.parts.length === 0 && (
        <p className="kasten-chat-thinking">
          <Working>Thinking</Working>
        </p>
      )}
      {streaming && answer.parts.length > 0 && <span className="kasten-chat-caret" aria-hidden="true" />}
      {streaming && step !== undefined && <p className="kasten-chat-step">Step {step}</p>}
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

/** An answer that stopped short for a reason that is no failure (a limit, a loop, the app closing): a calm
 * line that says why, and Continue to let it go on where it stopped. Only the newest can be continued. */
function PausedLine({ answer, thread }: { answer: Answer; thread: string }) {
  const pause = useChat((s) => s.threads[thread]?.pause);
  const newest = useChat((s) => {
    const messages = s.threads[thread]?.messages;
    return messages?.[messages.length - 1]?.id === answer.id;
  });
  if (!pause || !newest) return <p className="kasten-chat-status">Paused</p>;
  return (
    <div className="kasten-chat-paused" role="status">
      <span>{pause.detail}</span>
      <button type="button" onClick={() => void useChat.getState().continueThread(thread)}>
        Continue
      </button>
    </div>
  );
}

/** What can be done about a failed answer, by what failed: ask again, pick
 * another model, or fix the provider in Settings. Only the newest answer
 * offers to ask again, since that asks the newest question. */
function FailureActions({ answer, thread }: { answer: Answer; thread: string }) {
  const newest = useChat((s) => {
    const messages = s.threads[thread]?.messages;
    return messages?.[messages.length - 1]?.id === answer.id;
  });
  const kind = answer.errorKind ?? "other";
  const retry = (kind === "connection" || kind === "rateLimited" || kind === "other") && newest;
  const choose = kind === "modelUnavailable";
  const settings = kind === "permission" || kind === "modelUnavailable" || kind === "connection";
  if (!retry && !choose && !settings) return null;
  return (
    <div className="kasten-chat-failure">
      {retry && (
        <button type="button" onClick={() => void useChat.getState().retry(thread)}>
          Retry
        </button>
      )}
      {choose && (
        <button type="button" onClick={() => chooseModel(thread)}>
          Choose model
        </button>
      )}
      {settings && (
        <button type="button" onClick={() => openProviders("here")}>
          Open Settings
        </button>
      )}
    </div>
  );
}

function AnswerActions({ answer, thread }: { answer: Answer; thread: string }) {
  const links = useChatLinks();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pinned = useWorkspace((s) => (answer.pinned ? noteAt(s.notes, answer.pinned) : undefined));
  // Only the newest answer can be asked again: that asks the newest question.
  const newest = useChat((s) => {
    const messages = s.threads[thread]?.messages;
    return messages?.[messages.length - 1]?.id === answer.id;
  });
  const text = answerText(answer);
  const pin = async () => {
    setBusy(true);
    await pinAnswer(thread, answer, "here");
    setBusy(false);
  };
  return (
    <div className="kasten-chat-actions">
      <span className="kasten-chat-model-used" title={`${answer.provider} · ${answer.model}`}>
        {answer.model}
      </span>
      {text && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      {newest && answer.status !== "error" && (
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
