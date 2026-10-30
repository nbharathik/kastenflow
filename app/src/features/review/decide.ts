// Deciding on proposals: the vault call, the toast, refreshing the notes and
// the queue, and letting a decided card leave with a short animation. A
// failed decision leaves the card in place with the reason on it.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Proposal } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import type { SessionGroup } from "./group";
import { message, useReview } from "./store";
import { count, proposalLine } from "./words";

export type Verb = "accept" | "reject";

export interface CardState {
  /** The decision under way. */
  busy?: Verb;
  /** The last decision that failed, and why. */
  failed?: { verb: Verb; reason: string };
}

/** How long a decided card takes to fold away (review.css `.kr-leave`). */
export const LEAVE_MS = 220;

const past = (verb: Verb) => (verb === "accept" ? "Accepted" : "Rejected");

export function useDecisions() {
  const [states, setStates] = useState<Record<string, CardState>>({});
  /** Decided proposals still folding away, drawn even after the queue drops them. */
  const [leaving, setLeaving] = useState<Proposal[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const patch = useCallback((id: string, state: CardState | null) => {
    setStates((all) => {
      const next = { ...all };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }, []);

  /** Accepts or rejects one proposal; true when it went through. `quiet`
   * leaves the toast and the note list to the caller (bulk decisions). `body`
   * accepts a text change with only the hunks the person kept (the chat's cards). */
  const decide = useCallback(
    async (p: Proposal, verb: Verb, quiet = false, body?: string): Promise<boolean> => {
      const { client, toast, refresh } = useWorkspace.getState();
      if (!client) return false;
      patch(p.id, { busy: verb });
      try {
        if (verb === "accept") await (body === undefined ? client.acceptProposal(p.id) : client.acceptProposalHunks(p.id, body));
        else await client.rejectProposal(p.id);
      } catch (err) {
        patch(p.id, { failed: { verb, reason: message(err) } });
        void useReview.getState().refresh();
        return false;
      }
      // Off the queue at once, so the badge follows; the card stays drawn
      // (and its buttons off) while it folds away.
      useReview.getState().drop(p.id);
      void useReview.getState().refresh();
      setLeaving((list) => [...list, p]);
      if (!quiet) {
        toast(`${past(verb)} ${proposalLine(p)}`);
        void refresh();
      }
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setLeaving((list) => list.filter((l) => l.id !== p.id));
        patch(p.id, null);
      }, LEAVE_MS);
      timers.current.add(timer);
      return true;
    },
    [patch],
  );

  /** Decides every waiting proposal of one session, oldest first. Each is
   * its own commit; one that fails keeps its card and the rest go on. */
  const decideAll = useCallback(
    async (group: SessionGroup, verb: Verb) => {
      const { toast, refresh } = useWorkspace.getState();
      const waiting = group.proposals;
      let done = 0;
      for (const p of waiting) if (await decide(p, verb, true)) done++;
      void refresh();
      const all = count(waiting.length, "proposal");
      toast(done === waiting.length ? `${past(verb)} ${all} from ${group.client}` : `${past(verb)} ${done} of ${all} from ${group.client}; the others say why`);
    },
    [decide],
  );

  return { states, leaving, decide, decideAll };
}

const MODE_KEY = "kasten.review.diff";

/** Side by side or unified, remembered in this browser. */
export function useDiffMode(): ["split" | "unified", (mode: "split" | "unified") => void] {
  const [mode, setMode] = useState<"split" | "unified">(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "unified" ? "unified" : "split";
    } catch {
      return "split";
    }
  });
  const choose = useCallback((next: "split" | "unified") => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // A preference; losing it is fine.
    }
  }, []);
  return [mode, choose];
}
