// A thread's messages, the latest at the bottom. While an answer streams the
// list keeps to the bottom, unless you scrolled up to read; then a pill offers
// the way back. Sending a message always brings the bottom into view, smoothly
// unless motion is off; streamed growth is followed at once (anchored).

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { scrollMotion } from "../../../lib/motion";
import { Icon } from "../../../ui/Icon";
import { ChatProposals } from "../review/ChatProposals";
import { chipKey, lastQuestion, type Message, type Thread } from "../thread";
import { MessageRow } from "./Message";
import { PlanList } from "./PlanList";
import { SessionBar } from "./SessionBar";

/** Within this many pixels of the bottom counts as at the bottom. */
const NEAR = 48;

const contextOf = (m: Message) => (m.role === "user" ? m.context.map(chipKey).join("\u0001") : null);

/** What changes when a message is sent: the newest question, or one more waiting to go. */
function turnOf(thread: Thread): string {
  return `${lastQuestion(thread)?.id ?? ""}|${thread.queued?.length ?? 0}|${thread.offline?.length ?? 0}`;
}

/** What a polite reader is told when a turn ends. */
function endingOf(thread: Thread): string {
  const last = thread.messages[thread.messages.length - 1];
  if (last?.role !== "assistant") return "";
  return last.status === "done" ? "Answer finished" : last.status === "error" ? "Answer failed" : last.status === "paused" ? "Answer paused" : "";
}

export function MessageList({ thread, empty }: { thread: Thread; empty: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** A smooth scroll to the bottom is under way: growth is not followed at once until it lands. */
  const gliding = useRef(false);
  /** The list's height when it last told; a bar coming or going beside it changes that, and is not the person scrolling. */
  const seen = useRef(0);
  const turn = useRef(turnOf(thread));
  const streamed = useRef(thread.streaming);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [said, setSaid] = useState("");
  // Messages that were there when the thread opened do not enter; those that come after do.
  const opened = useRef({ id: thread.id, count: thread.messages.length });
  if (opened.current.id !== thread.id) opened.current = { id: thread.id, count: thread.messages.length };

  const toBottom = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    setUnseen(false);
    // A scroll that has nowhere to go fires no events to end it, so it is not waited for.
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (smooth && distance > 1 && scrollMotion() === "smooth" && typeof el.scrollTo === "function") {
      gliding.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      gliding.current = false;
      el.scrollTop = el.scrollHeight;
    }
  };

  useLayoutEffect(() => {
    stick.current = true;
    gliding.current = false;
    turn.current = turnOf(thread);
    streamed.current = thread.streaming;
    setAway(false);
    setUnseen(false);
    setSaid("");
    // A new thread starts at the bottom; `thread` is read once, for the turn it is at.
  }, [thread.id]);

  // Sending always brings the bottom into view, however far up the list was.
  const sent = turnOf(thread);
  useLayoutEffect(() => {
    if (sent === turn.current) return;
    turn.current = sent;
    toBottom(true);
  }, [sent]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) {
      // Landed (or never moved): growth is followed at once again.
      if (gliding.current && el.scrollHeight - el.scrollTop - el.clientHeight < NEAR) gliding.current = false;
      if (!gliding.current) el.scrollTop = el.scrollHeight;
    } else {
      // Something arrived below what is in view.
      setUnseen(true);
    }
  }, [thread.id, thread.messages, thread.changed]);

  // While it keeps to the bottom, it keeps to it when something beside the list makes it taller or shorter.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const landed = () => {
      gliding.current = false;
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("scrollend", landed);
    let watch: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      seen.current = el.clientHeight;
      watch = new ResizeObserver(() => {
        seen.current = el.clientHeight;
        if (stick.current && !gliding.current) el.scrollTop = el.scrollHeight;
      });
      watch.observe(el);
    }
    return () => {
      el.removeEventListener("scrollend", landed);
      watch?.disconnect();
    };
  }, []);

  // A turn that ends is said once, through a region of its own; the log itself is held back while it streams.
  useLayoutEffect(() => {
    if (thread.streaming && !streamed.current) setSaid("");
    if (!thread.streaming && streamed.current) setSaid(endingOf(thread));
    streamed.current = thread.streaming;
  }, [thread.streaming]);

  // A question shows its context where it starts or changes.
  let before: string | null = "";
  const last = thread.messages[thread.messages.length - 1];
  return (
    <div className="kasten-chat-scroll-wrap">
      <div
        ref={scroller}
        className="kasten-chat-scroll"
        onWheel={() => (gliding.current = false)}
        onTouchStart={() => (gliding.current = false)}
        onPointerDown={() => (gliding.current = false)}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientHeight !== seen.current) return;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
          // On the way down, the places passed are not the person scrolling up.
          if (gliding.current && !near) return;
          if (near) gliding.current = false;
          stick.current = near;
          setAway(!near);
          if (near) setUnseen(false);
        }}
      >
        <div className="kasten-chat-column">
          {thread.messages.length === 0 && !thread.offline?.length ? (
            empty
          ) : (
            <div role="log" aria-label="Messages" aria-busy={thread.streaming} className="kasten-chat-log">
              {thread.messages.map((message, index) => {
                const context = contextOf(message);
                const shown = context !== null && context !== before;
                if (context !== null) before = context;
                return (
                  <Fragment key={message.id}>
                    {/* The plan sits above the answer it belongs to: the newest. */}
                    {message === last && message.role === "assistant" && thread.plan && thread.plan.length > 0 && <PlanList plan={thread.plan} />}
                    <MessageRow message={message} thread={thread.id} contextShown={shown} enters={index >= opened.current.count} />
                  </Fragment>
                );
              })}
              {thread.queued?.map((text, i) => (
                <div key={`${i}:${text}`} className="kasten-chat-question is-pending" aria-label="Waiting to be sent">
                  <p className="kasten-chat-bubble">{text}</p>
                  <p className="kasten-chat-pending">Will be sent at the next step</p>
                </div>
              ))}
              {thread.offline?.map((one, i) => (
                <div key={`offline:${i}:${one.text}`} className="kasten-chat-question is-pending is-entering" aria-label="Waiting for the connection">
                  <p className="kasten-chat-bubble">{one.text}</p>
                  <p className="kasten-chat-pending">Offline — will send when you&apos;re back</p>
                </div>
              ))}
            </div>
          )}
          <ChatProposals thread={thread} />
          <SessionBar thread={thread} />
        </div>
      </div>
      {away && (thread.streaming || unseen) && (
        <button type="button" className="kasten-chat-jump" onClick={() => toBottom(true)}>
          {thread.streaming ? null : <span className="kasten-chat-jump-dot" aria-hidden="true" />}
          {thread.streaming ? "Jump to latest" : "New below"}
          <Icon name="chevron-down" className="size-3.5" />
        </button>
      )}
      {/* A live region of its own (not role="status": the views have their own statuses). */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-announcer="">
        {said}
      </div>
    </div>
  );
}
