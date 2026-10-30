// The two windows of a talk in the desktop app, joined. Each says where it is whenever that changes, and the app's core
// (src-tauri/src/presenter.rs) passes what one says to the other, without reading it. The presenter's view is a window of its own,
// made by the core.

import { type PresentSync, linkOver } from "@kasten-slides/react/presenter-entry";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** The event the core passes a message on as. */
const EVENT = "kasten://present";

/**
 * The link of this window to the other one. It listens on this window alone (a global listener hears the words meant for the other
 * window too, and a window that did would jump back to an older place), and every word carries the name of the window that said it,
 * so a window drops its own.
 *
 * The core numbers the presenter's windows and says the number in its "bye". With `window` given, a "bye" with a number that is not
 * the one the window holds (it is a late word of an older window, or came before the number was known) is dropped, so it cannot
 * close the link of a newer window.
 */
export async function tauriLink(window?: { number: number | null }): Promise<PresentSync> {
  const handlers = new Set<(payload: unknown) => void>();
  const stop = await getCurrentWebviewWindow().listen<unknown>(EVENT, (event) => {
    if (window && isLateBye(event.payload, window.number)) return;
    for (const handler of [...handlers]) handler(event.payload);
  });
  return linkOver({
    // A beat of the sync with the speaker's window; the next one carries the full state.
    send: (payload) => void invoke("presenter_post", { message: payload }).catch(() => {}),
    listen(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    close: stop,
  });
}

/** Whether `payload` is the core's "bye" for a window other than the one numbered `held`. */
function isLateBye(payload: unknown, held: number | null): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const { type, w } = payload as { type?: unknown; w?: unknown };
  return type === "bye" && typeof w === "number" && w !== held;
}

/** Opens the presenter's window for the deck at `path` and returns the link to it; null if it would not open. */
export async function openTauriPresenter(path: string): Promise<PresentSync | null> {
  let link: PresentSync | null = null;
  try {
    // Listening comes first, so that nothing the new window says is missed.
    const window: { number: number | null } = { number: null };
    link = await tauriLink(window);
    const number = await invoke<number | undefined>("open_presenter", { deckPath: path });
    window.number = typeof number === "number" ? number : null;
    return link;
  } catch {
    link?.close();
    return null;
  }
}

/** Lets the frames of a presentation load the pages the deck embeds (the core refuses every other address); an empty list ends it. */
export async function allowEmbeds(urls: string[]): Promise<void> {
  // Without the list the core refuses the embedded pages, which the slide then shows as blank frames.
  await invoke("allow_embeds", { urls }).catch(() => {});
}

/** The addresses of the pages a deck embeds, at any depth. */
export function embeddedPages(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.type === "embed" && typeof record.url === "string") found.add(record.url);
      for (const inner of Object.values(record)) walk(inner);
    }
  };
  walk(value);
  return [...found];
}
