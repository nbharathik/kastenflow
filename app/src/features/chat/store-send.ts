// Sending a message and carrying a paused turn on. A message sent while the
// model works is queued by the backend and waits for the next step; one sent
// when it is idle starts a turn, the question and its answer shown at once.

import { useWorkspace } from "../workspace/store";
import { allowed, capabilitiesOf, pruned } from "./capabilities";
import { keepModel, learnedEffort, modelFor, savedSettings } from "./prefs";
import { excerptsFor } from "./pdf-excerpts";
import { isSet } from "./settings";
import type { ChatState } from "./store";
import { trials } from "./store-learn";
import { bare, continued, endTurn, queueMessage, startTurn, turnStarted, type SentAttachment, type Thread } from "./thread";
import type { Excerpt, GenerationSettings } from "./types";

type Get = () => ChatState;
type Update = (id: string, change: (thread: Thread) => Thread) => void;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Hooks {
  /** Hands streamed text waiting for the next frame to the store. */
  flush(): void;
  toFront(id: string): void;
  /** Takes in the events a thread missed. */
  catchUp(id: string): Promise<void>;
  /** Writes the thread's copy now: a question asked is kept before its answer is. */
  save(id: string): void;
}

/** `send` and `continueThread` for the store's `get` and `update`. */
export function sendActions(get: Get, update: Update, hooks: Hooks): Pick<ChatState, "send" | "continueThread"> {
  /** What the model gets of the thread's settings (only what it takes), and the person's say on pictures. */
  async function settingsFor(thread: Thread, provider: string, model: string, id: string, pictures: boolean): Promise<GenerationSettings | undefined> {
    const client = get().ensure();
    const wanted = thread.settings ?? savedSettings(provider, model);
    let settings: GenerationSettings | undefined;
    if (isSet(wanted)) {
      const caps = await capabilitiesOf(client, provider, model);
      const fit = pruned(wanted, allowed(caps, wanted, learnedEffort(provider, model)));
      if (isSet(fit)) settings = fit;
      if (fit.reasoningEffort && caps && !caps.verified && learnedEffort(provider, model) !== "works") trials.set(id, { provider, model });
    }
    return pictures && thread.allowImages ? { ...settings, allowImages: true } : settings;
  }

  return {
    async send(id, text, attachments: SentAttachment[] = []) {
      const client = get().ensure();
      const thread = get().threads[id];
      const words = text.trim();
      if (!thread || !words || thread.stopping) return false;
      const choice = modelFor(thread, get().providers);
      if (!choice) return false;
      // While the model works, the message waits for its next step and the turn goes on.
      const working = thread.streaming;
      const begin = () => {
        update(id, (t) => startTurn(t, words, choice.provider, choice.model, attachments));
        keepModel(choice);
        hooks.toFront(id);
        hooks.save(id);
      };
      if (!working) begin();
      try {
        const settings = await settingsFor(thread, choice.provider, choice.model, id, attachments.some((a) => a.kind === "image"));
        // The pages of a PDF chip are read here: only the window can.
        const excerpts: Excerpt[] = await excerptsFor(thread.context);
        // Writes wait as staged changes unless the person let this thread write directly.
        const turn = await client.send({
          chat: id,
          provider: choice.provider,
          model: choice.model,
          text: words,
          context: thread.context.map(bare),
          ...(settings ? { settings } : {}),
          ...(excerpts.length ? { excerpts } : {}),
          ...(thread.direct ? { writes: "direct" as const } : {}),
          ...(attachments.length ? { attachments: attachments.map(({ id: kept, name, kind }) => ({ id: kept, name, kind })) } : {}),
        });
        if (turn.queued) {
          // It waits as a pending bubble. A question and answer made for it (the window thought the model idle) go.
          update(id, (t) => queueMessage(working ? t : { ...t, messages: t.messages.slice(0, -2), streaming: false }, words));
          return true;
        }
        // The turn it was sent into had ended already: this one is a turn of its own.
        if (working) begin();
        update(id, (t) => turnStarted(t, turn));
        if (working) await hooks.catchUp(id);
        // Stop pressed before the turn began reached nothing: ask again now.
        if (get().threads[id]?.stopping) await client.stop(id).catch(() => {});
      } catch (err) {
        hooks.flush();
        trials.delete(id);
        if (working) {
          useWorkspace.getState().toast(message(err));
          return false;
        }
        update(id, (t) => endTurn(t, "error", message(err)));
      }
      return true;
    },

    async continueThread(id) {
      const client = get().ensure();
      const before = get().threads[id];
      if (!before || before.streaming || !before.pause) return false;
      update(id, continued);
      try {
        const turn = await client.continueTurn(id);
        if (turn) update(id, (t) => turnStarted(t, turn));
        return true;
      } catch (err) {
        hooks.flush();
        // It stays paused, and the person is told why it did not go on.
        update(id, () => before);
        useWorkspace.getState().toast(message(err));
        return false;
      }
    },
  };
}
