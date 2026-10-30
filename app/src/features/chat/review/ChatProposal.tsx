// One proposal as a card in the conversation: the Review view's own card
// (ProposalCard, with its deck and diagram drawings), and what the chat adds
// to it: a text change with several hunks is kept or undone hunk by hunk, a
// proposal whose page changed since the agent read it says so and offers to
// ask again instead of applying, and "Open in Review" for the full queue.
// Deciding here is the same call as in Review (same core op, same undo).

import { useMemo, useState, type ReactNode } from "react";

import type { Proposal } from "../../../lib/vault/types";
import { ProposalCard } from "../../review/ProposalCard";
import type { CardState, Verb } from "../../review/decide";
import { BUTTON, PRIMARY } from "../../review/ui";
import { useWorkspace } from "../../workspace/store";
import { HunkList } from "./HunkList";
import { hunksOf, textKeeping } from "./hunks";
import { isTextChange, useStale } from "./stale";

interface Props {
  proposal: Proposal;
  state: CardState;
  /** Accepts or rejects; `body` accepts a text change with only the hunks kept. */
  onDecide(p: Proposal, verb: Verb, body?: string): void;
  /** Rejects the stale proposal and asks the agent to make the change again. */
  onRedo(p: Proposal): void;
}

const NO_STEP = () => {};

export function ChatProposal({ proposal: p, state, onDecide, onRedo }: Props) {
  const notes = useWorkspace((s) => s.notes);
  const openPath = useWorkspace((s) => s.openPath);
  const stale = useStale(p, state.failed?.reason);
  const hunks = useMemo(() => (isTextChange(p) ? hunksOf(p.before, p.after).hunks : []), [p]);
  const many = hunks.length > 1;
  const [undone, setUndone] = useState<ReadonlySet<number>>(() => new Set());
  const busy = Boolean(state.busy);
  const all = undone.size === hunks.length;
  const mixed = undone.size > 0 && !all;

  const choose = (index: number, keep: boolean) =>
    setUndone((now) => {
      const next = new Set(now);
      if (keep) next.delete(index);
      else next.add(index);
      return next;
    });

  /** What the card's own keys and buttons do: a stale change is never accepted, and the hunks chosen are what is kept. */
  const decide = (verb: Verb) => {
    if (verb === "accept" && stale) return;
    if (verb === "accept" && many && all) return onDecide(p, "reject");
    if (verb === "accept" && many && mixed && isTextChange(p)) return onDecide(p, "accept", textKeeping(p.before, p.after, undone));
    onDecide(p, verb);
  };

  const review = (
    <button type="button" className={`${BUTTON} kc-open-review`} onClick={() => useWorkspace.getState().go({ view: "review" })}>
      Open in Review
    </button>
  );

  let footer: ReactNode;
  if (stale) {
    footer = (
      <>
        <p className="kc-stale" role="status">
          This page changed since the agent read it.
        </p>
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => onRedo(p)}>
          Ask the agent to redo
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => onDecide(p, "reject")}>
          {state.busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
        {review}
      </>
    );
  } else if (many) {
    const primary = undone.size === 0 ? "Keep all" : all ? "Undo all" : `Keep ${hunks.length - undone.size} of ${hunks.length}`;
    footer = (
      <>
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => decide("accept")}>
          {state.busy === "accept" ? "Keeping…" : primary}
        </button>
        {mixed && (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => onDecide(p, "accept")}>
            Keep all
          </button>
        )}
        {!all && (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => onDecide(p, "reject")}>
            {state.busy === "reject" ? "Undoing…" : "Undo all"}
          </button>
        )}
        {review}
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => decide("accept")}>
          {state.busy === "accept" ? "Accepting…" : "Accept"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => decide("reject")}>
          {state.busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
        {review}
      </>
    );
  }

  return (
    <div className="kc-proposal">
      <ProposalCard
        proposal={p}
        state={state}
        mode="unified"
        note={p.target ? notes.find((n) => n.path === p.target!.path) : undefined}
        onDecide={decide}
        onOpen={openPath}
        onStep={NO_STEP}
        change={many && !stale ? <HunkList hunks={hunks} undone={undone} disabled={busy} label={`Changes to ${p.target?.title ?? "the page"}`} onChoose={choose} /> : undefined}
        footer={footer}
      />
    </div>
  );
}
