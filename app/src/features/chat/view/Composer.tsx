// Where a message is written: the thread's context chips (and the files,
// pictures and long pastes waiting to go with it), a box of a fixed size (three
// rows that scroll: it never changes with what is typed, how wide the chat is
// or what is above it), the model, and Send, with Stop beside it while an
// answer streams. Send while it works queues the message for the model's next
// step. Enter sends and Shift+Enter starts a new line. Typing @ or [[ picks a
// page to add as context. Files dropped or pasted on the box are attached.
// Without a provider the box says why it is off.

import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useShallow } from "zustand/react/shallow";

import type { NoteMeta } from "../../../lib/vault/types";
import { Picker } from "../../library/Picker";
import { useWorkspace } from "../../workspace/store";
import { sentOf, useAttachments } from "../attach-store";
import { noteChip } from "../context";
import { requestEdit } from "../edit-request";
import { drafts } from "../message-drafts";
import { modelFor } from "../prefs";
import { useChat } from "../store";
import { composerOf, lastQuestion, type ComposerThread } from "../thread";
import type { AiAction } from "../types";
import { usePasteDrop } from "../usePasteDrop";
import { NotePick } from "./AddContext";
import { INSERT_TEXT } from "./AttachmentChips";
import { ContextChips } from "./ContextChips";
import { FollowToggle } from "./FollowToggle";
import { ModelPicker } from "./ModelPicker";

export interface ComposerHandle {
  /** Puts `text` in the box, ready to send or change. */
  fill(text: string): void;
}

interface Props {
  /** The thread it writes to; it reads the fields it needs from the store, so a streamed answer does not redraw it. */
  id: string;
  /** The page "This page" adds. */
  page: NoteMeta | null;
  autoFocus?: boolean;
  /** What the empty box of a new chat says. */
  ask?: string;
  /** Whether the bar has the "Follow active page" switch: not where the chat follows something else (a slide). */
  showFollow?: boolean;
  ref?: Ref<ComposerHandle>;
}

export const Composer = memo(function Composer({ id, ...rest }: Props) {
  const thread = useChat(useShallow((s) => composerOf(s.threads[id])));
  const started = useChat((s) => (s.threads[id]?.messages.length ?? 0) > 0);
  return thread ? <Box thread={thread} started={started} {...rest} /> : null;
});

function Box({ thread, started, page, autoFocus = false, ask = "Ask about your notes…", showFollow = true, ref }: Omit<Props, "id"> & { thread: ComposerThread; started: boolean }) {
  const providers = useChat((s) => s.providers);
  const [text, setText] = useState(() => drafts.get(thread.id) ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const notes = useWorkspace((s) => s.notes);
  // Where an @ or [[ was typed, while its page picker is open.
  const [mention, setMention] = useState<{ at: number; length: number } | null>(null);
  // The AI actions of the chat, listed after a "/" typed into an empty box.
  const [slash, setSlash] = useState<{ actions: AiAction[] | null } | null>(null);
  const choice = modelFor(thread, providers);
  const off = choice ? null : providers === null ? "Reading your AI providers…" : "Add an AI provider in Settings to chat";
  // Files still being read are waited for; while the model works a message is queued, not refused.
  const reading = useAttachments((s) => s.byThread[thread.id]?.some((a) => a.state === "busy") ?? false);
  const ready = Boolean(text.trim()) && !thread.stopping && !off && !reading;
  const paste = usePasteDrop(thread.id, !off);

  const change = (next: string) => {
    setText(next);
    if (next) drafts.set(thread.id, next);
    else drafts.delete(thread.id);
  };

  // A long paste given back as text goes in at the caret.
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    const on = (event: Event) => {
      const { thread: id, text: given } = (event as CustomEvent<{ thread: string; text: string }>).detail;
      if (id !== thread.id) return;
      const at = box.current?.selectionStart ?? latest.current.length;
      const next = latest.current.slice(0, at) + given + latest.current.slice(at);
      change(next);
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.setSelectionRange(at + given.length, at + given.length);
      });
    };
    window.addEventListener(INSERT_TEXT, on);
    return () => window.removeEventListener(INSERT_TEXT, on);
    // `change` only keeps this thread's draft, which `thread.id` names.
  }, [thread.id]);

  useImperativeHandle(ref, () => ({
    fill(next) {
      change(next);
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.setSelectionRange(next.length, next.length);
      });
    },
  }));

  /** Opens the list of AI actions when a "/" starts an empty box. */
  const openSlash = () => {
    setSlash({ actions: null });
    useChat
      .getState()
      .ensure()
      .aiActions()
      .then(
        (found) => setSlash((was) => (was ? { actions: found.actions.filter((a) => a.where.includes("chat")) } : was)),
        () => setSlash((was) => (was ? { actions: [] } : was)),
      );
  };
  /** An action chosen puts what it does in the box, to add to or send. */
  const closeSlash = (slug: string | null) => {
    const picked = slash?.actions?.find((a) => a.slug === slug);
    setSlash(null);
    if (picked) change(picked.instruction);
    requestAnimationFrame(() => {
      box.current?.focus();
      const end = box.current?.value.length ?? 0;
      box.current?.setSelectionRange(end, end);
    });
  };

  /** Opens the page picker when what was just typed is @ or [[. */
  const typed = (next: string, caret: number) => {
    const before = next.slice(0, caret);
    if (next === "/" && text === "") return openSlash();
    if (next.length <= text.length) return;
    if (/(^|\s)@$/.test(before)) setMention({ at: caret - 1, length: 1 });
    else if (before.endsWith("[[")) setMention({ at: caret - 2, length: 2 });
  };
  const closeMention = (picked: NoteMeta | null) => {
    const at = mention?.at ?? text.length;
    if (picked && mention) {
      useChat.getState().addChip(thread.id, noteChip(picked));
      change(text.slice(0, mention.at) + text.slice(mention.at + mention.length));
    }
    setMention(null);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
    });
  };

  const send = async () => {
    if (!ready) return;
    const words = text;
    change("");
    // What waits to go with it goes; if the message does not, it all comes back.
    const taken = useAttachments.getState().take(thread.id);
    if (!(await useChat.getState().send(thread.id, words, taken.map(sentOf)))) {
      change(words);
      useAttachments.getState().restore(thread.id, taken);
    }
  };

  return (
    <form
      ref={form}
      className="kasten-chat-composer"
      aria-label="Write a message"
      data-dragging={paste.dragging || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      {...paste.drop}
    >
      <ContextChips thread={thread} page={page} />
      <textarea
        ref={box}
        rows={3}
        value={text}
        autoFocus={autoFocus}
        disabled={Boolean(off)}
        aria-label="Message"
        placeholder={off ?? (thread.streaming ? "Add to it: it is read at the next step…" : started ? "Reply…" : ask)}
        onPaste={paste.onPaste}
        onChange={(event) => {
          typed(event.target.value, event.target.selectionStart ?? event.target.value.length);
          change(event.target.value);
        }}
        onKeyDown={(event) => {
          // The up arrow in an empty box opens the newest question to be changed.
          if (event.key === "ArrowUp" && text === "" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
            const asked = lastQuestion(useChat.getState().threads[thread.id]);
            if (asked) {
              event.preventDefault();
              requestEdit(thread.id, asked.id);
            }
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
      />
      {mention && (
        <div className="kasten-chat-mention">
          <NotePick notes={notes} within={form} onClose={() => closeMention(null)} onPick={(note) => closeMention(note)} />
        </div>
      )}
      {slash && (
        <div className="kasten-chat-mention">
          <Picker
            label="Run an AI action"
            placeholder="Find an action…"
            options={slash.actions?.map((action) => ({ key: action.slug, label: action.title })) ?? null}
            empty="No actions for the chat"
            within={form}
            onClose={() => closeSlash(null)}
            onPick={closeSlash}
          />
        </div>
      )}
      <div className="kasten-chat-composer-bar">
        <ModelPicker thread={thread} />
        <span className="kasten-chat-grow" />
        {showFollow && <FollowToggle thread={thread} />}
        {thread.streaming && (
          <button
            type="button"
            className="kasten-chat-stop"
            disabled={thread.stopping}
            aria-label={thread.stopping ? "Stopping…" : "Stop"}
            title={thread.stopping ? "Stopping…" : "Stop"}
            onClick={() => void useChat.getState().stop(thread.id)}
          >
            <span className="kasten-chat-stop-mark" aria-hidden="true" />
            <span className="kasten-chat-stop-label">{thread.stopping ? "Stopping…" : "Stop"}</span>
          </button>
        )}
        <button type="submit" className="kasten-chat-send" disabled={!ready} aria-label="Send" title={thread.streaming ? "Send: it is read at the next step (Enter)" : "Send (Enter)"}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
