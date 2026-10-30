// What an answer says about how it ended, besides its text: paused with a way
// to go on, failed with a way to ask again, or finished with nothing to say.

import { useEffect, useState } from "react";

import { startInterval } from "../../../lib/use-interval";
import { openProviders } from "../actions";
import { useChat } from "../store";
import type { Answer } from "../thread";
import { chooseModel } from "./ModelPicker";

/** Whether `answer` is the newest message of the thread: the only one that can be asked again. */
function useNewest(answer: Answer, thread: string): boolean {
  return useChat((s) => {
    const messages = s.threads[thread]?.messages;
    return messages?.[messages.length - 1]?.id === answer.id;
  });
}

/** An answer that stopped short for a reason that is no failure (a limit, a loop, the app closing): a calm
 * line that says why, and Continue to let it go on where it stopped. Only the newest can be continued. */
export function PausedLine({ answer, thread }: { answer: Answer; thread: string }) {
  const pause = useChat((s) => s.threads[thread]?.pause);
  const newest = useNewest(answer, thread);
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

/** An answer that ended well and said nothing. */
export function EmptyLine({ answer, thread }: { answer: Answer; thread: string }) {
  const newest = useNewest(answer, thread);
  return (
    <div className="kasten-chat-failure">
      <span className="kasten-chat-status">No reply came back</span>
      {newest && (
        <button type="button" onClick={() => void useChat.getState().retry(thread)}>
          Retry
        </button>
      )}
    </div>
  );
}

/** How long a rate limit is waited out before the question is asked once more by itself. */
export const RATE_WAIT_SECONDS = 20;

/** The questions asked again by themselves after a rate limit: once each, so a limit that stays is not hammered. */
const askedAgain = new Set<string>();

/** Counts down from `seconds` and calls `done` once at zero. */
function useCountdown(seconds: number | null, done: () => void): number | null {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (seconds === null) return;
    setLeft(seconds);
    // The wait is counted while the window is shown; hidden, it holds.
    return startInterval(() => setLeft((was) => (was === null ? was : Math.max(0, was - 1))), 1000);
  }, [seconds]);
  useEffect(() => {
    if (left === 0) done();
    // `done` only asks the question again; the countdown reaching zero is the trigger.
  }, [left]);
  return left;
}

/** What can be done about a failed answer, by what failed: ask again, pick
 * another model, or fix the provider in Settings. Only the newest answer
 * offers to ask again, since that asks the newest question. After a rate
 * limit it counts down and asks again by itself, once. */
export function FailureActions({ answer, thread }: { answer: Answer; thread: string }) {
  const newest = useNewest(answer, thread);
  const asked = useChat((s) => {
    const messages = s.threads[thread]?.messages;
    const question = messages?.[messages.length - 2];
    return question?.role === "user" ? `${thread}:${question.text}` : null;
  });
  const kind = answer.errorKind ?? "other";
  const retry = (kind === "connection" || kind === "rateLimited" || kind === "other") && newest;
  const choose = kind === "modelUnavailable";
  const settings = kind === "permission" || kind === "modelUnavailable" || kind === "connection";
  const waiting = kind === "rateLimited" && newest && asked !== null && !askedAgain.has(asked);
  const left = useCountdown(waiting ? RATE_WAIT_SECONDS : null, () => {
    if (!asked || askedAgain.has(asked)) return;
    askedAgain.add(asked);
    void useChat.getState().retry(thread);
  });
  if (!retry && !choose && !settings) return null;
  return (
    <div className="kasten-chat-failure">
      {waiting && left !== null && left > 0 && (
        <span className="kasten-chat-status" role="status">
          Rate limited. Trying again in {left}s
        </span>
      )}
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
