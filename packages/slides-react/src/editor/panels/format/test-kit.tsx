// A real deck, session and panel for the tests of the panel's sections.

import type { DeckEngine, Element } from "@kasten-slides/wasm";
import { type RenderResult, act, fireEvent, render, screen, within } from "@testing-library/react";

import { newDeck } from "../../../test/engine.ts";
import { MemoryHost } from "../../memory-host.ts";
import { EditorSession } from "../../session/session.ts";
import { EditorUi, type PanelName } from "../../ui-state.ts";
import { SidePanel } from "../SidePanel.tsx";

export interface Kit {
  engine: DeckEngine;
  session: EditorSession;
  ui: EditorUi;
  host: MemoryHost;
  /** What the session told the person could not be done. */
  errors: string[];
  view: RenderResult;
  /** The ids of the elements put on the slide, in the order given. */
  ids: string[];
}

interface Options {
  theme?: string;
  /** Put on a blank slide and selected. */
  elements?: Element[];
  /** Which of them stay selected (by place in `elements`); all by default, none for []. */
  select?: number[];
  panel?: PanelName | null;
}

/** An editor on a blank slide holding `elements`, with the panel open. */
export async function mount({ theme = "Light", elements = [], select, panel = "format" }: Options = {}): Promise<Kit> {
  // What the chrome keeps in the browser (folded sections, the fonts and colours used lately) starts empty in every test.
  localStorage.clear();
  const engine = await newDeck("Panels", theme);
  const host = new MemoryHost();
  const errors: string[] = [];
  const session = new EditorSession(engine, host, { saveDelay: 60_000, onError: (message) => errors.push(message) });
  const ui = new EditorUi();
  let ids: string[] = [];
  act(() => {
    session.slides.add({ layout: "blank" });
    if (elements.length > 0) ids = session.elements.insert(elements);
    if (select) session.select(select.map((i) => ids[i] as string));
    ui.openPanel(panel);
  });
  const view = render(<SidePanel session={session} ui={ui} />);
  return { engine, session, ui, host, errors, view, ids };
}

/** Changes the session the way a menu or a key would, with React let to catch up. */
export const edit = (change: () => void): void => {
  act(change);
};

/** The section of the panel with this id. */
export function section(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-section="${id}"]`);
  if (!found) throw new Error(`No section called ${id} in the panel`);
  return found;
}

export const hasSection = (id: string): boolean => document.querySelector(`[data-section="${id}"]`) !== null;

/** The ids of the sections shown, in order. */
export const sections = (): string[] => [...document.querySelectorAll<HTMLElement>("[data-section]")].map((s) => s.dataset.section as string);

/** Types into a number field and presses Enter. */
export function enter(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** The element on the slide with this id, as the deck holds it now. */
export function held(kit: Kit, id: string): Element {
  const found = kit.session.slide.elements.find((e) => e.id === id);
  if (!found) throw new Error(`No element ${id} on the slide`);
  return found;
}

/** Opens a colour button and picks a swatch by its name. */
export function pickColor(button: string, swatch: string, scope: HTMLElement | null = null): void {
  fireEvent.click((scope ? within(scope) : screen).getByRole("button", { name: button }));
  fireEvent.click(screen.getByLabelText(swatch));
}

/** Lets a slider go at a value. */
export function slide(slider: HTMLElement, value: number): void {
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.blur(slider);
}
