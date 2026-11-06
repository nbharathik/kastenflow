// What an agent asks of the window for code pictures: run the code of a picture, and (before agent-written code runs for a deck that
// is not allowed) ask the person. The app sends these as events and waits for the answer; the window answers each one and never
// throws, so the app hears why when something fails.

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { inTauri } from "../../../lib/api";
import { type RunJob, answerRunJob } from "./answer";
import { type AskRequest, useGeneratorAsk } from "./ask-state";

/** The event the app asks for code to be run with, and the one that asks the person to allow it. */
export const RUN_EVENT = "kasten://run-generator";
export const ASK_EVENT = "kasten://allow-generator";

/** What the app sends with the question. */
type AskJob = AskRequest;

/** Answers the app's requests to run code, and shows its questions, for as long as the window is there. */
export function useRunGeneratorsForAgents(): void {
  useEffect(() => {
    if (!inTauri()) return;
    let gone = false;
    const stops: (() => void)[] = [];
    const keep = (unlisten: () => void) => (gone ? unlisten() : void stops.push(unlisten));
    void listen<RunJob>(RUN_EVENT, (event) => void answerRunJob(event.payload)).then(keep);
    void listen<AskJob>(ASK_EVENT, (event) => useGeneratorAsk.getState().push(event.payload)).then(keep);
    return () => {
      gone = true;
      for (const stop of stops) stop();
    };
  }, []);
}
