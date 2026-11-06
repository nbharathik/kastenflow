// The questions waiting for a person: an agent wrote code that draws a picture in a deck, and the code has not been allowed to run
// for that deck yet. Tiny on purpose: the shell reads it at start-up, and the dialog that asks is loaded when there is a question.

import { create } from "zustand";

/** What the app asks the person to allow. */
export interface AskRequest {
  /** Answers the app's request when the person has decided. */
  id: string;
  /** The deck (a vault path) whose code this is. */
  deck: string;
  /** The agent's client, such as `claude-code`. */
  agent: string;
  /** The start of the code, and how long all of it is. */
  code: string;
  codeBytes: number;
  /** The hash (SHA-256, hex) of all of the code, which "Allow to run" is kept for. */
  hash: string;
  /** The names of what the code may read. */
  inputs: string[];
}

interface AskState {
  queue: AskRequest[];
  push(request: AskRequest): void;
  /** The first question has been answered. */
  next(): void;
}

export const useGeneratorAsk = create<AskState>((set) => ({
  queue: [],
  push: (request) => set((state) => (state.queue.some((q) => q.id === request.id) ? state : { queue: [...state.queue, request] })),
  next: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

/** Whether the person is being asked something. */
export const useAsking = (): boolean => useGeneratorAsk((state) => state.queue.length > 0);
