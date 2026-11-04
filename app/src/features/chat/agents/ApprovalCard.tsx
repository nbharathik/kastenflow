// A coding agent asks whether it may do something (run a command, use the web):
// the card says what, with Allow and Deny. The agent waits for the answer. A
// card whose question is over (answered, withdrawn, or the run ended) shows how
// it ended. Both buttons are reached with Tab.

import "./agents.css";

import { useState } from "react";

import { useWorkspace } from "../../workspace/store";
import { answerApproval } from "./client";
import type { Approval, ApprovalState } from "./types";

const STATES: Record<Exclude<ApprovalState, "asking">, string> = { allowed: "Allowed", denied: "Denied", over: "No longer asked" };

export function ApprovalCard({ thread, ask }: { thread: string; ask: Approval }) {
  const [busy, setBusy] = useState(false);
  // The question was not open any more when the button was pressed (the app was restarted, the run ended).
  const [gone, setGone] = useState(false);
  const state: ApprovalState = ask.state === "asking" && gone ? "over" : ask.state;

  const answer = async (allow: boolean) => {
    setBusy(true);
    try {
      if (!(await answerApproval(thread, ask.id, allow))) setGone(true);
    } catch (err) {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kasten-chat-approval" role="group" aria-label={ask.question} data-state={state} aria-live={state === "asking" ? "polite" : undefined}>
      <p className="kasten-chat-approval-q">{ask.question}</p>
      {ask.detail && <pre className="kasten-chat-approval-detail">{ask.detail}</pre>}
      {state === "asking" ? (
        <div className="kasten-chat-approval-actions">
          <button type="button" disabled={busy} onClick={() => void answer(true)}>
            Allow
          </button>
          <button type="button" disabled={busy} onClick={() => void answer(false)}>
            Deny
          </button>
        </div>
      ) : (
        <p className="kasten-chat-approval-state">{STATES[state]}</p>
      )}
    </div>
  );
}
