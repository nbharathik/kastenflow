// The editor's assistant tab: Kasten's chat, in a thread of its own for this deck, told which slide and which
// elements are selected. What the assistant changes is marked in the deck until the person accepts it or changes it.

import "../pages/editor/styles/tokens.css";
import "../chat/chat.css";
import "../chat/threads.css";
import "../chat/messages.css";
import "../chat/composer.css";
import "../chat/menus.css";
import "./ai-tab.css";

import type { AiPanelProps } from "@kasten-slides/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../../ui/Icon";
import { ChangeSetBar } from "../chat/changes/ChangeSetBar";
import { usePanelPrefs } from "../chat/panel-prefs";
import { useChat } from "../chat/store";
import { threadStatus, threadTitle } from "../chat/thread";
import { STATUS_WORDS, useViewing } from "../chat/unread";
import { Composer } from "../chat/view/Composer";
import { useChatSetup } from "../chat/view/Conversation";
import { NoProvider } from "../chat/view/Empty";
import { LinksContext, linksFor } from "../chat/view/links";
import { MessageList } from "../chat/view/MessageList";
import { AdoptFailed } from "../chat/view/AdoptFailed";
import { WaitingNotice } from "../chat/view/WaitingNotice";
import { followSlide, leaveSlide, newDeckThread, restoreDeckThread, retryDeckThread, slideChip, threadOfDeck } from "./ai-thread";

/** Settings → AI → Chat panel → "Links from the assistant open", as the way the workspace opens a place. */
export const OPENS = { beside: "right", tab: "tab", here: "here" } as const;

const ASKS = ["Tighten the words on this slide", "Suggest a diagram that shows this", "Check the deck and fix what lint reports"];

/** What an empty thread says: what the assistant can do here, and a few things to ask. */
function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="kasten-chat-empty">
      <h2>Ask for a change to the deck</h2>
      <p>The assistant sees the slide you are on and the elements you select. What it changes waits above the message box for you to review and apply, and “Undo this chat’s changes” takes applied changes back. With “Apply directly” on, changes are made at once and marked with a star until you accept them or change them yourself.</p>
      <div className="kasten-chat-suggestions" role="group" aria-label="Start with">
        {ASKS.map((text) => (
          <button key={text} type="button" onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The assistant tab of the Slides editor. */
export function AiTab(props: AiPanelProps) {
  useChatSetup();
  const [thread, setThread] = useState<string | null>(null);
  /** The saved chat of this deck that could not be read back. */
  const [failed, setFailed] = useState<string | null>(null);
  const shown = useRef<{ thread: string; key: string } | null>(null);
  const deck = props.deckPath ?? "";
  const chip = useMemo(
    () => slideChip(props),
    // The chip is made again when the slide or the selection changes, not on every edit of the deck.
    [props.deckPath, props.slideId, props.slideNumber, props.slideTitle, props.elementIds.join("\u0000")],
  );
  const providers = useChat((s) => s.providers);
  const problem = useChat((s) => s.providersError);
  const active = useChat((s) => (thread ? s.threads[thread] : undefined));
  const composer = useRef<{ fill(text: string): void }>(null);
  // A link in the assistant never takes the deck's own tab over unless Settings say so: it opens beside the deck, or in a tab of its own.
  const where = usePanelPrefs((s) => s.assistantLinks);
  const links = useMemo(() => linksFor("dock", OPENS[where]), [where]);

  // The deck's thread; one kept from an earlier run is brought back first.
  useEffect(() => {
    let live = true;
    setFailed(null);
    const found = deck ? restoreDeckThread(deck) : null;
    // Usually there at once; a thread kept from an earlier run has to be read first.
    if (typeof found === "string" || found === null) setThread(found);
    else void found.then((got) => live && (typeof got === "string" ? setThread(got) : (setThread(null), setFailed(got.failed))));
    return () => {
      live = false;
    };
  }, [deck]);
  // While the tab shows it, what it finished or stopped for is seen.
  useViewing(thread);

  useEffect(() => {
    if (!thread) return;
    const before = shown.current;
    shown.current = { thread, key: followSlide(thread, chip, before && before.thread === thread ? before.key : null) };
  }, [thread, chip]);

  useEffect(
    () => () => {
      const last = shown.current;
      if (last) leaveSlide(last.thread, last.key);
      shown.current = null;
    },
    [],
  );

  if (!deck) return <p className="ks-ai-note">The assistant works on decks kept in the vault.</p>;
  // Never an empty chat in the place of one that could not be read: Retry, or start a new one.
  if (failed) {
    return (
      <section className="kasten-chat ks-ai" data-variant="dock" aria-label="Assistant">
        <AdoptFailed
          id={failed}
          onRetry={async () => {
            const got = await retryDeckThread(deck, failed);
            if (typeof got === "string") {
              setFailed(null);
              setThread(got);
            }
          }}
          onNew={() => {
            setFailed(null);
            setThread(threadOfDeck(deck, true));
          }}
        />
      </section>
    );
  }
  if (!thread || !active) return null;
  const none = providers !== null && providers.length === 0;
  // What the assistant is doing here, said when it is not simply at rest.
  const status = threadStatus(active);
  const word = status === "done" ? "" : STATUS_WORDS[status];
  return (
    <LinksContext.Provider value={links}>
      <section className="kasten-chat ks-ai" data-variant="dock" aria-label="Assistant">
        <header className="kasten-chat-head">
          <span className="kasten-chat-title" title={threadTitle(active)}>
            {active.messages.length ? threadTitle(active) : "Assistant"}
          </span>
          {word && (
            <span className="kasten-chat-meta" data-status={status} role="status">
              {active.streaming && <span className="kasten-chat-live" aria-hidden="true" />} {word}
            </span>
          )}
          <button
            type="button"
            className="kasten-chat-icon-button"
            aria-label="New chat"
            title="New chat"
            disabled={active.messages.length === 0 || active.streaming}
            // The old chat stays in the list; the deck's tie moves to the new one.
            onClick={() => void newDeckThread(deck, thread).then(setThread)}
          >
            <Icon name="compose" className="size-4" />
          </button>
        </header>
        <MessageList thread={active} empty={none ? <NoProvider problem={problem} /> : <Welcome onPick={(text) => composer.current?.fill(text)} />} />
        {props.pending > 0 && (
          <div className="ks-ai-review" role="status">
            <Icon name="agent" className="size-4" />
            <span>
              {props.pending} {props.pending === 1 ? "element is" : "elements are"} the assistant’s, not accepted yet
            </span>
            <button type="button" onClick={props.acceptAll}>
              Accept all
            </button>
          </div>
        )}
        <div className="kasten-chat-foot">
          <WaitingNotice thread={active} />
          <ChangeSetBar thread={active} />
          <Composer key={active.id} ref={composer} thread={active} page={null} ask="Ask for a change to the deck…" showFollow={false} />
        </div>
      </section>
    </LinksContext.Provider>
  );
}
