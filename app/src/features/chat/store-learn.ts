// What a turn finds out about a model: a reasoning effort it took or refused.
// The backend remembers it (and sends the question again without the effort);
// this keeps it between runs.

import { capabilitiesOf, forgetCapabilities } from "./capabilities";
import type { ChatClient } from "./client";
import { learnEffort } from "./prefs";

/** Turns that asked for a reasoning effort the model was not known to take,
 * by thread: what they found out is kept when they end. */
export const trials = new Map<string, { provider: string; model: string }>();

/** Learns from a turn that tried a reasoning effort. Whether it found anything out. */
export async function learnFromTrial(client: ChatClient, chat: string, worked: boolean): Promise<boolean> {
  const trial = trials.get(chat);
  if (!trial) return false;
  trials.delete(chat);
  forgetCapabilities(trial.provider, trial.model);
  const caps = await capabilitiesOf(client, trial.provider, trial.model);
  if (caps?.effortRefused) learnEffort(trial.provider, trial.model, "refused");
  else if (worked && caps) learnEffort(trial.provider, trial.model, "works");
  else return false;
  return true;
}
