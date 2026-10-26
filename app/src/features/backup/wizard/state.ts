// The backup setup's progress, kept in one small store so closing the panel
// (Escape) and opening it again continues at the same step, and so the job of
// the first backup goes on while the panel is closed. This file is all that
// the palette, Home and the status bar load; the panel itself loads when it
// is first wanted (WizardHost.tsx).

import { create } from "zustand";

import type { LinkChoice, Protection, RepoRow, Visibility } from "../../../lib/vault/backup-types";

export type Step = "where" | "signin" | "repo" | "first" | "host" | "folder" | "next";
export type Where = "github" | "host" | "folder" | "both";

/** What the first backup came to, for the summary. */
export type Summary =
  | { kind: "github"; fullName: string; htmlUrl: string; visibility: Visibility; protection: Protection | null }
  | { kind: "host"; remote: string }
  | { kind: "folder"; folder: string };

/** Why a chosen repository was not used yet. */
export type Verdict =
  | { kind: "public"; repo: RepoRow; protection: Protection | null }
  | { kind: "refused"; repo: RepoRow; choices: LinkChoice[] };

export type Job = "idle" | "running" | "done" | "failed";

/** Which folder browser is on screen in place of the panel. */
export type Picker = { kind: "folder" } | { kind: "restore"; repo: RepoRow } | null;

interface WizardState {
  open: boolean;
  step: Step;
  where: Where | null;
  login: string | null;
  job: Job;
  problem: string | null;
  summary: Summary | null;
  verdict: Verdict | null;
  /** The name was taken: the repository by that name, to use instead. */
  taken: RepoRow | null;
  picker: Picker;
  /** Runs the last job again (set by the job, used by "Try again"). */
  retry: (() => void) | null;
  show(): void;
  hide(): void;
  go(step: Step): void;
  patch(change: Partial<Omit<WizardState, "show" | "hide" | "go" | "patch" | "reset">>): void;
  reset(): void;
}

const FRESH = {
  step: "where" as Step,
  where: null as Where | null,
  login: null as string | null,
  job: "idle" as Job,
  problem: null as string | null,
  summary: null as Summary | null,
  verdict: null as Verdict | null,
  taken: null as RepoRow | null,
  picker: null as Picker,
  retry: null as (() => void) | null,
};

export const useBackupWizard = create<WizardState>()((set, get) => ({
  ...FRESH,
  open: false,
  show: () => set({ open: true }),
  // Finished: nothing is left to continue. Otherwise the progress stays.
  hide: () => (get().step === "next" ? set({ ...FRESH, open: false }) : set({ open: false, picker: null })),
  go: (step) => set({ step }),
  patch: (change) => set(change),
  reset: () => set({ ...FRESH, open: false }),
}));

/** Opens "Keep your notes safe": the guided backup setup. */
export const openBackupWizard = (): void => useBackupWizard.getState().show();
