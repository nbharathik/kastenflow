// What a thread's header says about it: its name, which the person can
// change, and the model and settings it answers with.

import { useRef, useState, type ElementType, type FormEvent, type KeyboardEvent } from "react";

import { Icon } from "../../../ui/Icon";
import { modelFor, savedSettings } from "../prefs";
import { describe } from "../settings";
import { useChat } from "../store";
import { threadTitle, type Thread } from "../thread";

interface TitleProps {
  thread: Thread;
  /** The element that holds the name: a heading in the Chat view. */
  as?: ElementType;
}

/** The thread's name, with a button to change it: Enter keeps the new name,
 * Escape leaves the old, and an empty name goes back to the first question. */
export function ThreadTitle({ thread, as: Tag = "span" }: TitleProps) {
  const [editing, setEditing] = useState(false);
  // The field is gone once it has been answered: its blur then says nothing.
  const answered = useRef(false);
  const title = threadTitle(thread);
  const keep = (text: string) => {
    if (answered.current) return;
    answered.current = true;
    useChat.getState().rename(thread.id, text);
    setEditing(false);
  };
  if (editing) {
    return (
      <form
        className="kasten-chat-rename"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          keep((event.currentTarget.elements.namedItem("name") as HTMLInputElement).value);
        }}
      >
        <input
          name="name"
          autoFocus
          aria-label="Chat name"
          defaultValue={thread.title ?? (thread.messages.length ? title : "")}
          maxLength={120}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => keep(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            answered.current = true;
            setEditing(false);
          }}
        />
      </form>
    );
  }
  return (
    <>
      <Tag className="kasten-chat-title" title={title}>
        {title}
      </Tag>
      <button
        type="button"
        className="kasten-chat-icon-button kasten-chat-rename-button"
        aria-label="Rename chat"
        title="Rename this chat"
        onClick={() => {
          answered.current = false;
          setEditing(true);
        }}
      >
        <Icon name="edit" className="size-3.5" />
      </button>
    </>
  );
}

/** "Claude · model-small · High effort": the model this thread answers with
 * and what is set for it. */
export function ThreadModel({ thread }: { thread: Thread }) {
  const providers = useChat((s) => s.providers);
  const choice = modelFor(thread, providers);
  if (!choice) return null;
  const settings = describe(thread.settings ?? savedSettings(choice.provider, choice.model));
  const line = [choice.provider, choice.model, settings].filter(Boolean).join(" · ");
  return (
    <span className="kasten-chat-meta" title={`Answers with ${line}`}>
      {line}
    </span>
  );
}
