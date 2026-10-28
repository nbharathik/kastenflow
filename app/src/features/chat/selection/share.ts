// What is told to the app while a client reads the selection (see sharing.ts,
// which decides when). It is what the chat already holds as selected text (the
// chips above the message box), kept to the page, PDF, deck or LaTeX file in
// the focused pane, and, for a deck, the slide in front with the elements
// selected on it. The app keeps it where only that client can read it and never
// in the notes' history. Loaded only once a client has asked.

import { invoke } from "@tauri-apps/api/core";

import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { activePlace } from "../open-pages";
import { useChat } from "../store";
import type { Chip } from "../thread";
import { useSharing } from "./sharing";

/** How long a change must hold still before it is told. */
export const SHARE_DELAY_MS = 300;
/** The most pieces shared (the app keeps five). */
const MOST = 5;

/** One piece of what is selected, as the app takes it. */
export interface Shared {
  kind: "page" | "pdf" | "slide" | "latex";
  path: string;
  title: string;
  heading?: string;
  range?: { from: number; to: number };
  elements?: string[];
  text: string;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") || path;

/** A page as the person names it; a file by its name. */
function titleFor(kind: Shared["kind"], path: string): string {
  if (kind === "page") {
    const note = noteAt(useWorkspace.getState().notes, path);
    if (note) return titleOf(note);
  }
  return baseName(path);
}

/** The words a selection chip holds, with where they are. */
function ofChip(chip: Chip): Shared | null {
  const held = chip.selection;
  if (chip.kind !== "selection" || !held || held.text.trim() === "") return null;
  const { source, text, heading, range } = held;
  const page = source.kind === "pdf" && source.id ? `Page ${source.id}` : undefined;
  const under = heading ?? page;
  return {
    kind: source.kind,
    path: source.path,
    title: titleFor(source.kind, source.path),
    ...(under ? { heading: under } : {}),
    ...(range ? { range } : {}),
    ...(source.kind === "slide" && source.id ? { elements: [source.id] } : {}),
    text,
  };
}

/** The slide in front in `deck` with the elements selected on it, from the chip the deck's assistant keeps. */
function ofSlide(deck: string): Shared | null {
  const threads = Object.values(useChat.getState().threads);
  const chip = threads.find((t) => t.bound?.kind === "deck" && t.bound.path === deck && !t.archived)?.context.find((c) => c.kind === "slide");
  const elements = chip?.ref.slice(2).filter(Boolean) ?? [];
  if (!chip || chip.ref[0] !== deck || elements.length === 0) return null;
  return { kind: "slide", path: deck, title: baseName(deck), heading: chip.label.split(" · ")[0], elements, text: "" };
}

/** What is selected now, in the page in front: the chat's selection chips for it, then the slide's selected elements. */
export function sharedNow(): Shared[] {
  const place = activePlace();
  if (!place?.path) return [];
  const chat = useChat.getState();
  const thread = chat.active ? chat.threads[chat.active] : undefined;
  const found = (thread?.context ?? []).map(ofChip).filter((s): s is Shared => s !== null && s.path === place.path);
  const slide = place.view === "slides" ? ofSlide(place.path) : null;
  return (slide ? [...found, slide] : found).slice(0, MOST);
}

/** Telling the app what is selected: `again` tells it now, even if nothing changed; `stop` ends it. */
export interface Telling {
  again(): void;
  stop(): void;
}

/** Starts telling the app what is selected, now and whenever it changes. */
export function begin(): Telling {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  let ended = false;
  const tell = () => {
    timer = null;
    if (ended) return;
    const now = sharedNow();
    const key = JSON.stringify(now);
    // The app renews what it holds while it is shared; only a change needs telling.
    if (key === last) return;
    last = key;
    invoke<boolean>("selection_publish", { snippets: now })
      .then((kept) => {
        // The app is not sharing any more: the line that says so goes.
        if (!kept && !ended) useSharing.setState({ shared: false });
      })
      .catch(() => {
        last = "";
      });
  };
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tell, SHARE_DELAY_MS);
  };
  const stops = [useChat.subscribe(soon), useWorkspace.subscribe(soon)];
  // What is selected as a client asks counts at once: the ask waits for this word.
  tell();
  return {
    again() {
      if (timer) clearTimeout(timer);
      last = "";
      tell();
    },
    stop() {
      ended = true;
      if (timer) clearTimeout(timer);
      for (const stop of stops) stop();
    },
  };
}
