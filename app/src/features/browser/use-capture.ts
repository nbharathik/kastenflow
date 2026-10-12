// A capture from the browser tab, step by step: ask the app to read the page
// or the selection (it holds what it read), show the person what would be
// kept, and write it only on Save, at the place chosen. Nothing here sees
// what the page said beyond the preview the app made of it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { INBOX, MAX_RECENT, orderedTargets, readRecent, remember, type Places, type Target } from "../../capture/targets";
import { dayFrom } from "../../lib/dates";
import type { VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { browserBackend } from "./backend";
import type { Previewed, Saved, Where } from "./types";

const RECENT = "kasten.capture.recent";

function load(): string | null {
  try {
    return localStorage.getItem(RECENT);
  } catch {
    return null;
  }
}

function store(targets: readonly Target[]): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify(targets));
  } catch {
    // Recent places last while the window does.
  }
}

/** Where a place in the picker goes: the journal is today's page. */
export async function whereOf(target: Target, client: Pick<VaultClient, "journal">): Promise<Where> {
  switch (target.kind) {
    case "inbox":
      return { kind: "inbox" };
    case "project":
      return { kind: "project", project: target.slug };
    case "page":
      return { kind: "page", path: target.path };
    case "journal":
      return { kind: "page", path: (await client.journal(dayFrom(0))).meta.path };
  }
}

export type Phase = "idle" | "reading" | "preview" | "saving";

export interface Capture {
  phase: Phase;
  preview: Previewed | null;
  /** The title that will be kept; the person may change it. */
  title: string;
  setTitle(title: string): void;
  error: string | null;
  target: Target;
  /** The places the picker offers. */
  places: Places;
  /** Picks the place the capture will go to. */
  choose(target: Target): void;
  start(kind: "selection" | "page"): Promise<void>;
  save(): Promise<Saved | null>;
  discard(): void;
}

/** The capture state of browser tab `id`. */
export function useCapture(id: string, onSaved?: (saved: Saved) => void): Capture {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<Previewed | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Target[]>(() => readRecent(load()));
  const [target, setTarget] = useState<Target | null>(null);
  const held = useRef<string | null>(null);
  const saved = useRef(onSaved);
  useEffect(() => {
    saved.current = onSaved;
  });

  const places = useMemo<Places>(
    () => ({
      projects: notes.filter((n) => n.kind === "project" && n.project).map((n) => ({ slug: n.project!, title: n.title })),
      recent,
      pages: notes.filter((n) => n.kind !== "template" && n.kind !== "project").map((n) => ({ path: n.path, title: n.title, modified: n.modified })),
    }),
    [notes, recent],
  );
  // The place last used, else the Inbox, until another is chosen.
  const chosen = target ?? orderedTargets(places)[0] ?? INBOX;

  /** Lets the app forget what it held for a preview. */
  const release = useCallback(() => {
    const token = held.current;
    held.current = null;
    if (token) void browserBackend().discard(token).catch(() => {});
  }, []);

  const discard = useCallback(() => {
    release();
    setPreview(null);
    setError(null);
    setPhase("idle");
  }, [release]);

  // A tab that goes, or is shown no more, lets go of what it held.
  useEffect(() => {
    return release;
  }, [id, release]);

  const start = useCallback(
    async (kind: "selection" | "page") => {
      release();
      setPreview(null);
      setError(null);
      setPhase("reading");
      try {
        const made = await browserBackend().capture(id, kind);
        held.current = made.token;
        setPreview(made);
        setTitle(made.title);
        setPhase("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("idle");
      }
    },
    [id, release],
  );

  const save = useCallback(async (): Promise<Saved | null> => {
    const token = held.current;
    if (!token || !client) return null;
    setPhase("saving");
    setError(null);
    try {
      const where = await whereOf(chosen, client);
      const done = await browserBackend().confirm(token, where, title.trim() || null);
      held.current = null;
      const next = remember(recent, chosen).slice(0, MAX_RECENT);
      setRecent(next);
      store(next);
      setPreview(null);
      setPhase("idle");
      saved.current?.(done);
      return done;
    } catch (err) {
      // The app keeps what it read, so another place can be tried.
      setError(err instanceof Error ? err.message : String(err));
      setPhase("preview");
      return null;
    }
  }, [chosen, client, recent, title]);

  return { phase, preview, title, setTitle, error, target: chosen, places, choose: setTarget, start, save, discard };
}
