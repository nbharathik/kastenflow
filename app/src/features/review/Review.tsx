import "./review.css";

import { useCallback, useMemo, useRef, useState } from "react";

import { FlipList } from "../../lib/FlipList";
import type { Proposal } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { useDecisions, useDiffMode, type CardState, type Verb } from "./decide";
import { bySession, oldestFirst, type SessionGroup } from "./group";
import { ProposalCard } from "./ProposalCard";
import { useReview, useReviewPolling } from "./store";
import { Segmented } from "../../ui/Segmented";
import { BUTTON, Callout, ClientBadge, ConfirmBar, Empty, QUIET } from "./ui";
import { count } from "./words";
import { Icon } from "../../ui/Icon";
import { Wait } from "../../ui/Wait";

const NO_STATE: CardState = {};

/** The review queue: agent changes that
 * met a guardrail, oldest first and grouped by session, each to accept or
 * reject. Accepting runs the change as a normal commit; rejecting archives it. */
export function Review() {
  useReviewPolling();
  const proposals = useReview((s) => s.proposals);
  const loaded = useReview((s) => s.loaded);
  const error = useReview((s) => s.error);
  const notes = useWorkspace((s) => s.notes);
  const [mode, setMode] = useDiffMode();
  const { states, leaving, decide, decideAll } = useDecisions();
  const cards = useRef(new Map<string, HTMLElement>());

  // Cards on their way out stay drawn until their animation ends.
  const shown = useMemo(() => oldestFirst([...proposals, ...leaving.filter((l) => !proposals.some((p) => p.id === l.id))]), [proposals, leaving]);
  const groups = useMemo(() => bySession(shown), [shown]);
  const order = useMemo(() => groups.flatMap((g) => g.proposals.map((p) => p.id)), [groups]);
  const gone = useMemo(() => new Set(leaving.map((l) => l.id)), [leaving]);

  /** Focus the card `delta` steps from `id`, skipping ones on their way out. */
  const step = useCallback(
    (id: string, delta: 1 | -1) => {
      const live = order.filter((o) => o === id || !gone.has(o));
      const next = live[live.indexOf(id) + delta];
      if (next) cards.current.get(next)?.focus();
    },
    [order, gone],
  );

  const onDecide = useCallback(
    (p: Proposal, verb: Verb) => {
      const card = cards.current.get(p.id);
      const hadFocus = Boolean(card && card.contains(document.activeElement));
      void decide(p, verb).then((ok) => {
        if (!ok || !hadFocus) return;
        // Keep the keyboard flow going: the next card, else the one before.
        // It slides into the decided card's place, so no scrolling is needed.
        const live = order.filter((o) => o === p.id || !gone.has(o));
        const at = live.indexOf(p.id);
        const next = live[at + 1] ?? live[at - 1];
        if (next) cards.current.get(next)?.focus({ preventScroll: true });
      });
    },
    [decide, order, gone],
  );

  const waiting = proposals.length;
  const openPath = useWorkspace.getState().openPath;

  return (
    <div className="mx-auto w-full max-w-[1040px] px-6 pb-24 pt-10 sm:px-12">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-28 font-bold tracking-tight">
          <Icon name="review" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          Review
          {waiting > 0 && <span className="ml-2.5 align-middle text-16 font-medium text-muted">{count(waiting, "proposal")}</span>}
        </h1>
        {shown.length > 0 && (
          <Segmented
            label="Diff layout"
            value={mode}
            onChange={setMode}
            choices={[
              { value: "split", label: "Side by side" },
              { value: "unified", label: "Unified" },
            ]}
          />
        )}
      </div>
      <p className="mt-1 max-w-[680px] text-14 text-muted">
        Agent changes that met a guardrail wait here for you. Accept runs one as a normal commit; Reject archives it. The decision remains in the review history.
      </p>
      {error && (
        <div className="mt-4">
          <Callout tone="bad" icon="alert" role="alert">
            Could not read the review queue: {error}
          </Callout>
        </div>
      )}

      {!loaded && shown.length === 0 && <Wait className="py-10 text-center" label="Reading the review queue" />}
      {loaded && shown.length === 0 && !error && <NothingToReview />}

      {groups.map((group) => (
        <section key={group.session} aria-label={`Proposals from ${group.client}`} className="mt-8">
          <SessionHeader group={group} live={group.proposals.filter((p) => !gone.has(p.id) && !states[p.id]?.busy)} onAll={decideAll} />
          <FlipList className="mt-3" order={group.proposals.map((p) => p.id).join(",")}>
            {group.proposals.map((p) => (
              <div key={p.id} className="kr-leave" data-leaving={gone.has(p.id)} data-flip={p.id}>
                <div className={`min-h-0 pb-4 ${gone.has(p.id) ? "overflow-hidden" : ""}`}>
                  <ProposalCard
                    ref={(el: HTMLElement | null) => {
                      if (el) cards.current.set(p.id, el);
                      else cards.current.delete(p.id);
                    }}
                    proposal={p}
                    state={states[p.id] ?? NO_STATE}
                    mode={mode}
                    note={p.target ? notes.find((n) => n.path === p.target!.path) : undefined}
                    onDecide={(verb) => onDecide(p, verb)}
                    onOpen={openPath}
                    onStep={(delta) => step(p.id, delta)}
                  />
                </div>
              </div>
            ))}
          </FlipList>
        </section>
      ))}
    </div>
  );
}

/** A session's name, its count, and deciding all its proposals at once. */
function SessionHeader({ group, live, onAll }: { group: SessionGroup; live: Proposal[]; onAll(group: SessionGroup, verb: Verb): Promise<void> }) {
  const [asking, setAsking] = useState<Verb | null>(null);
  const [running, setRunning] = useState(false);
  const n = live.length;
  const run = async (verb: Verb) => {
    setAsking(null);
    setRunning(true);
    await onAll({ ...group, proposals: live }, verb);
    setRunning(false);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <ClientBadge client={group.client} />
        <span className="text-13 text-muted" title={`Session ${group.session}`}>
          session …{group.session.slice(-6)} · {count(group.proposals.length, "proposal")}
        </span>
        {n > 1 && (
          <span className="ml-auto flex gap-1">
            <button type="button" className={QUIET} disabled={running} onClick={() => setAsking("accept")}>
              Accept all
            </button>
            <button type="button" className={QUIET} disabled={running} onClick={() => setAsking("reject")}>
              Reject all
            </button>
          </span>
        )}
      </div>
      {asking && n > 1 && (
        <div className="mt-2">
          <ConfirmBar
            title={`${asking === "accept" ? "Accept" : "Reject"} all ${count(n, "proposal")} from ${group.client}?`}
            detail={
              asking === "accept"
                ? "Each runs as its own commit, oldest first. Any that cannot apply stay here with the reason."
                : "They move to the proposals archive. Your notes do not change."
            }
            confirm={asking === "accept" ? "Accept all" : "Reject all"}
            onConfirm={() => void run(asking)}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}
    </div>
  );
}

function NothingToReview() {
  const go = useWorkspace((s) => s.go);
  return (
    <Empty icon="review" title="Nothing to review">
      <p>
        An agent's change waits here when it rewrites a whole note, removes much of one, trashes a board or changes a tag schema, or when its session
        changes more notes than the limits allow. Everything else agents do is in History, where a whole session can be undone.
      </p>
      <button type="button" className={`${BUTTON} mt-4`} onClick={() => go({ view: "history" })}>
        Open History
      </button>
    </Empty>
  );
}
