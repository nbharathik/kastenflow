// A real deck, session and the dialogs for their tests.

import type { DeckEngine, Element } from "@kasten-slides/wasm";
import { type RenderResult, act, render } from "@testing-library/react";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { type DialogName, EditorUi } from "../ui-state.ts";
import { Dialogs, preloadDialogs } from "./Dialogs.tsx";

export interface Kit {
  engine: DeckEngine;
  session: EditorSession;
  ui: EditorUi;
  host: MemoryHost;
  errors: string[];
  view: RenderResult;
  /** The ids of the elements put on the slide, in the order given. */
  ids: string[];
}

interface Options {
  theme?: string;
  /** Put on a blank slide, which is shown. */
  elements?: Element[];
  /** Which of them are selected (by place in `elements`); all by default. */
  select?: number[];
  dialog?: DialogName | null;
  /** Work on the deck before the dialog is drawn. */
  prepare?: (engine: DeckEngine) => void;
  /** Add a blank slide and show it (the default); false leaves the deck as `prepare` made it, on its first slide. */
  blank?: boolean;
}

export async function mountDialogs({ theme = "Light", elements = [], select, dialog = null, prepare, blank = true }: Options = {}): Promise<Kit> {
  // The dialogs are loaded on first use; a test that opens one expects it drawn at once.
  await preloadDialogs();
  const engine = await newDeck("Dialogs", theme);
  prepare?.(engine);
  const host = new MemoryHost();
  const errors: string[] = [];
  const session = new EditorSession(engine, host, { saveDelay: 60_000, onError: (message) => errors.push(message) });
  const ui = new EditorUi();
  let ids: string[] = [];
  act(() => {
    if (blank) session.slides.add({ layout: "blank" });
    if (elements.length > 0) ids = session.elements.insert(elements);
    if (select) session.select(select.map((i) => ids[i] as string));
    ui.openDialog(dialog);
  });
  const view = render(<Dialogs session={session} ui={ui} />);
  return { engine, session, ui, host, errors, view, ids };
}

/** Changes the session the way a menu or a key would, with React let to catch up. */
export const edit = (change: () => void): void => {
  act(change);
};
