// How much agents may do, as the window holds it: read once the vault is open
// and when the window comes back into view, and changed only by a person (the
// Settings choice, the palette commands, the top-bar mark's Turn off). The core says
// what holds; this keeps the answer.

import { create } from "zustand";

import type { AgentMode, AgentPolicy, AgentPolicyView } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { MODE_NAMES, turnedOff, untilWords, withMode, withProject, type TimeBox } from "./policy";

interface AgentModeState {
  /** What is set and what holds; null until the first read. */
  view: AgentPolicyView | null;
  /** The time box shown as picked for the next autonomous choice. */
  box: TimeBox;
  /** Why the last read failed, if it did. */
  error: string | null;
  load(): Promise<void>;
  /** Keeps `policy`; true when it was kept. A failure is said in a toast. */
  save(policy: AgentPolicy): Promise<boolean>;
  /** The vault's mode, with the time box for autonomous. */
  setMode(mode: AgentMode, box?: TimeBox): Promise<boolean>;
  /** One project's own mode, or null to follow the vault's. */
  setProjectMode(folder: string, mode: AgentMode | null): Promise<boolean>;
  /** Ends every autonomous scope at once. */
  turnOff(): Promise<boolean>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The part of a view that is set, without what holds. */
export const policyOf = (view: AgentPolicyView | null): AgentPolicy => ({
  mode: view?.mode ?? "balanced",
  until: view?.until ?? null,
  projects: { ...(view?.projects ?? {}) },
});

/** Reads started; only the latest one's answer counts. */
let reads = 0;

/** Whether what is set is known, reading it just now: another window or program may
 * have changed it since this window last looked, and a change built on an old copy would
 * write that copy back over it. A change built on a guess would wipe the person's
 * per-project modes, so a read that fails refuses the change. */
async function known(get: () => AgentModeState): Promise<boolean> {
  await get().load();
  if (get().view !== null && get().error === null) return true;
  useWorkspace.getState().toast("Could not read how much agents may do, so nothing was changed. Try again in a moment.");
  return false;
}

export const useAgentMode = create<AgentModeState>()((set, get) => ({
  view: null,
  box: "hour",
  error: null,

  async load() {
    const read = ++reads;
    const client = useWorkspace.getState().client;
    if (!client) return set({ view: null, error: null });
    try {
      const view = await client.agentPolicy();
      if (read === reads) set({ view, error: null });
    } catch (err) {
      // Not knowing leaves the mark as it was; the next read tries again.
      if (read === reads) set({ error: message(err) });
    }
  },

  async save(policy) {
    const client = useWorkspace.getState().client;
    if (!client) return false;
    try {
      const view = await client.setAgentPolicy(policy);
      reads += 1;
      set({ view, error: null });
      return true;
    } catch (err) {
      useWorkspace.getState().toast(message(err));
      return false;
    }
  },

  async setMode(mode, box = get().box) {
    if (!(await known(get))) return false;
    set({ box });
    return get().save(withMode(policyOf(get().view), mode, box, Date.now()));
  },

  async setProjectMode(folder, mode) {
    if (!(await known(get))) return false;
    return get().save(withProject(policyOf(get().view), folder, mode, get().box, Date.now()));
  },

  async turnOff() {
    if (!(await known(get))) return false;
    const done = await get().save(turnedOff(policyOf(get().view)));
    if (done) useWorkspace.getState().toast("Autonomous agents are off.");
    return done;
  },
}));

/** What the palette says after a mode is picked. */
export function modeToast(view: AgentPolicyView, now = Date.now()): string {
  if (view.active === "autonomous") return `Autonomous agents are on ${untilWords(view.until, now)}. Turn them off from the icon in the top bar.`;
  return `Agents: ${MODE_NAMES[view.active]}`;
}
