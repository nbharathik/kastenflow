// An answer being written for the AI panel: one request at a time, its text
// shown a frame after it arrives (so a fast stream does not redraw per
// piece), stopped by Stop or by leaving, and ended as done or failed.
// The request itself is the caller's: a write for the editor's own actions,
// or a run of an AI action.

import { useRef, useState } from "react";

import { useChat } from "../../../chat/store";
import type { Written } from "../../../chat/types";

export type Phase = "asking" | "writing" | "done" | "failed" | "setup";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
let runs = 0;

export function useAnswer(initial: Phase) {
  const [phase, setPhase] = useState<Phase>(initial);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<{ id: string; live: boolean } | null>(null);
  const buffer = useRef("");
  const frame = useRef(0);

  /** Stops the answer under way, keeping what came. */
  const stop = () => {
    const current = run.current;
    if (current?.live) void useChat.getState().ensure().stopWrite(current.id);
  };
  /** Stops it and forgets it. */
  const abandon = () => {
    stop();
    run.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  /** Starts an answer: `job` asks for it under the id given, passing the
   * text on as it comes. An answer under way is given up first. */
  const start = async (job: (id: string, onText: (piece: string) => void) => Promise<Written>) => {
    abandon();
    const mine = { id: `write-${Date.now().toString(36)}-${++runs}`, live: true };
    run.current = mine;
    buffer.current = "";
    setText("");
    setNote(null);
    setError(null);
    setPhase("writing");
    const onText = (piece: string) => {
      if (run.current !== mine) return;
      buffer.current += piece;
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          if (run.current === mine) setText(buffer.current);
        });
      }
    };
    try {
      const written = await job(mine.id, onText);
      if (run.current !== mine) return;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setText(written.text);
      if (!written.text.trim()) {
        setError(written.stopped ? "Stopped before anything was written." : "The model wrote nothing. Try again, or ask another way.");
        setPhase("failed");
      } else {
        setNote(written.note ?? (written.stopped ? "Stopped: take what was written, or try again." : null));
        setPhase("done");
      }
    } catch (err) {
      if (run.current !== mine) return;
      setError(message(err));
      setPhase("failed");
    } finally {
      mine.live = false;
    }
  };

  return { phase, setPhase, text, note, error, setError, start, stop, abandon };
}
