// The proposals this chat's agent session made that wait for you, as cards
// after the conversation, so a change is decided where it was asked for.
// Proposals from agents outside the app are not drawn here (they would crowd
// the conversation); a quiet line says how many wait in Review.

import "../../review/review.css";
import "./chat-review.css";

import { useEffect, useMemo } from "react";

import type { Proposal } from "../../../lib/vault/types";
import { useDecisions, type CardState, type Verb } from "../../review/decide";
import { oldestFirst } from "../../review/group";
import { useReview, useReviewPolling } from "../../review/store";
import { count } from "../../review/words";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import type { Thread } from "../thread";
import { ChatProposal } from "./ChatProposal";

const NO_STATE: CardState = {};

export function ChatProposals({ thread }: { thread: Thread }) {
  useReviewPolling();
  const waiting = useReview((s) => s.proposals);
  const { states, leaving, decide } = useDecisions();
  const session = thread.session;
  const mine = useMemo(() => (session ? waiting.filter((p) => p.session === session) : []), [waiting, session]);
  // Cards on their way out stay drawn until their animation ends.
  const shown = useMemo(() => oldestFirst([...mine, ...leaving.filter((l) => l.session === session && !mine.some((p) => p.id === l.id))]), [mine, leaving, session]);
  const gone = useMemo(() => new Set(leaving.map((l) => l.id)), [leaving]);
  const elsewhere = waiting.length - mine.length;

  // A turn that ends may have left proposals: read them now, not at the next poll.
  const working = thread.streaming;
  useEffect(() => {
    if (!working) void useReview.getState().refresh();
  }, [working]);

  const redo = async (p: Proposal) => {
    if (!(await decide(p, "reject", true))) return;
    const title = p.target?.title ?? "the page";
    await useChat.getState().send(thread.id, `The page “${title}” changed after you read it, so your change to it was not applied. Read it again and make the change again.`);
  };

  if (shown.length === 0 && elsewhere === 0) return null;
  return (
    <section className="kc-proposals" aria-label="Changes waiting for you">
      {shown.map((p) => (
        <div key={p.id} className="kr-leave" data-leaving={gone.has(p.id)}>
          <div className={`min-h-0 pb-3 ${gone.has(p.id) ? "overflow-hidden" : ""}`}>
            <ChatProposal proposal={p} state={states[p.id] ?? NO_STATE} onDecide={(each: Proposal, verb: Verb, body?: string) => void decide(each, verb, false, body)} onRedo={(each) => void redo(each)} />
          </div>
        </div>
      ))}
      {elsewhere > 0 && (
        <p className="kc-elsewhere">
          {count(elsewhere, "change")} from other agents {elsewhere === 1 ? "waits" : "wait"} in{" "}
          <button type="button" onClick={() => useWorkspace.getState().go({ view: "review" })}>
            Review
          </button>
        </p>
      )}
    </section>
  );
}
