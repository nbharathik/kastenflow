// The Slides home's "From an outline" and "From a note": two ways to begin that use what the app already does. Neither writes anything the
// other starts do not: a deck is made through the vault client (as for a blank one), and the note is turned into slides by the page's own
// "Turn sections into a deck", which shows a storyboard first and makes nothing until the person says so.

import type { NoteMeta } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { keepDeckUi } from "./deck-ui";
import { makeDeck } from "./make-deck";

/** How often, and how long apart, the page is asked for its sections while its editor opens. */
const TRIES = 20;
const WAIT_MS = 100;

/** A blank deck that opens in its Outline view, to type the talk as a list and have the slides follow. Answers its path, or null if it could not be made. */
export async function startFromOutline(): Promise<string | null> {
  const { client, openPath, toast } = useWorkspace.getState();
  if (!client) return null;
  try {
    const path = await makeDeck(client, { template: "Light", examples: false });
    // The editor opens on this window state, as a deck put away and shown again does.
    keepDeckUi(path, { panel: null, view: "outline", slideId: "", slideSelection: [], selection: [], filmstripOpen: true, filmstripWidth: null, filmstripScroll: 0 });
    openPath(path, "here");
    return path;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
    return null;
  }
}

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Opens the note and asks for its sections as slides. The page's editor opens a moment after the page does, so it is asked again a few
 * times; if it never answers, the person is told where the same command is.
 */
export async function startFromNote(note: NoteMeta): Promise<void> {
  const { openPath, toast } = useWorkspace.getState();
  openPath(note.path, "here");
  const [{ sectionTexts }, { turnSectionsIntoDeck }] = await Promise.all([import("../pages/editor/sections/registry"), import("../pages/present/to-deck")]);
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    if (sectionTexts(note.id || note.path)) return turnSectionsIntoDeck(note);
    await later(WAIT_MS);
  }
  toast("Open the page's menu and choose Turn sections into a deck.");
}
