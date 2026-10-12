// The session a layout is designed in. The layout is a slide (slides-core's `design_deck`), so the editor's own canvas, tools and
// format panel work on it as on any slide; it is a deck of its own in memory, and nothing it does reaches the deck's file until
// "Done" hands the slide back to the real deck as one operation.

import { DeckEngine } from "@kasten-slides/wasm";

import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";

/**
 * A host that is the deck's host for pictures and notices, and keeps the rest of the real host out of the designer: what the
 * designer saves goes nowhere, and it has no assistant, no presenter, no templates and no deck file.
 */
export function designHost(host: SlidesHost): SlidesHost {
  const own = Object.create(host) as SlidesHost;
  own.save = async () => ({ status: "saved" });
  for (const key of ["deckPath", "aiPanel", "templates", "favourite", "openPresenter", "willPresent", "fillScreen", "synced", "openPath", "pickDiagram", "editDiagram"] as const) {
    Object.defineProperty(own, key, { value: undefined, configurable: true });
  }
  return own;
}

export interface Design {
  session: EditorSession;
  ui: EditorUi;
}

/** Opens the layout `name` of the session's deck for designing. Throws what the engine says when it cannot. */
export function openDesign(session: EditorSession, name: string): Design {
  const engine = DeckEngine.open(session.core.layoutDesign(name));
  const nested = new EditorSession(engine, designHost(session.host), {
    // It is never saved.
    saveDelay: 24 * 3_600_000,
    onError: (message) => session.host.notify?.(message),
  });
  const ui = new EditorUi();
  ui.designing = true;
  ui.openPanel("format");
  return { session: nested, ui };
}
