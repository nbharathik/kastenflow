// What the window's diagram host (DiagramHost, loaded only when it has
// something to do) is asked for: the diagram open in a modal editor, and the
// diagrams to draw again off screen for a picture that is missing or out of
// date. Kept small so asking costs nothing until the host is needed.

import { create } from "zustand";

import { pluginOff, turnPluginOn } from "../../plugins/off";
import { useWorkspace } from "../workspace/store";
import { useDiagramEditor } from "./editor";

/** What the picker answers: the diagram chosen, and whether it was just made (so it is drawn before it is used). */
export interface Picked {
  path: string;
  created: boolean;
}

/** A diagram to be drawn as a PNG off screen, and how its answer is told. */
export interface PngJob {
  id: number;
  path: string;
  scale: number;
  resolve(bytes: Uint8Array): void;
  reject(why: Error): void;
}

let jobs = 0;

interface HostState {
  /** The diagram open in the modal editor. */
  modal: string | null;
  /** Diagrams waiting to be drawn as PNGs by the editor, first first. */
  pngs: PngJob[];
  /** Asks the editor, off screen, for a PNG of the diagram at `path`, `scale` times its size. Rejects with why it could not. */
  renderPng(path: string, scale: number): Promise<Uint8Array>;
  /** The PNG job is over (answered, refused or given up on). */
  donePng(id: number): void;
  /** Someone is waiting for a diagram to be chosen: how the choice is told to them. */
  picker: ((picked: Picked | null) => void) | null;
  /** The deck the picker was opened from, if it was: "Draw with AI" in the picker is about its slide. */
  pickFor: string | null;
  /** Diagrams waiting to be drawn again, first first. */
  queue: string[];
  /** Diagrams drawn again this session, or tried and given up on, so none is asked for twice. */
  seen: string[];
  /** Diagrams open in an editor now, whose pictures the editor keeps itself. */
  editing: string[];
  openModal(path: string): void;
  closeModal(): void;
  /** Asks the person to choose a diagram (or make one); resolves to null when they close the picker. One at a time: asking again cancels the first. */
  pick(from?: { deck?: string }): Promise<Picked | null>;
  answerPick(picked: Picked | null): void;
  /** Asks for the picture of `path` to be drawn again, when the editor is installed and it was not asked for already. */
  redraw(path: string): void;
  done(path: string): void;
  setEditing(path: string, on: boolean): void;
}

export const useDiagramHost = create<HostState>((set, get) => ({
  modal: null,
  pngs: [],
  renderPng: (path, scale) =>
    new Promise<Uint8Array>((resolve, reject) => {
      if (!useDiagramEditor.getState().info?.installed) return reject(new Error("The diagram editor is not installed"));
      set((s) => ({ pngs: [...s.pngs, { id: ++jobs, path, scale, resolve, reject }] }));
    }),
  donePng: (id) => set((s) => ({ pngs: s.pngs.filter((j) => j.id !== id) })),
  picker: null,
  pickFor: null,
  queue: [],
  seen: [],
  editing: [],
  openModal: (path) => set({ modal: path }),
  closeModal: () => set({ modal: null }),
  pick: (from) =>
    new Promise<Picked | null>((resolve) => {
      get().picker?.(null);
      set({ picker: resolve, pickFor: from?.deck ?? null });
    }),
  answerPick(picked) {
    const answer = get().picker;
    set({ picker: null, pickFor: null });
    answer?.(picked);
  },
  redraw(path) {
    if (!useDiagramEditor.getState().info?.installed) return;
    const { queue, seen, editing } = get();
    if (queue.includes(path) || seen.includes(path) || editing.includes(path)) return;
    set({ queue: [...queue, path] });
  },
  setEditing: (path, on) => set((s) => ({ editing: on ? [...new Set([...s.editing, path])] : s.editing.filter((p) => p !== path) })),
  done: (path) => set((s) => ({ queue: s.queue.filter((p) => p !== path), seen: [...s.seen, path].slice(-500) })),
}));

/** Forgets that `path` was drawn again, so a later change to it is. */
export function drawAgainLater(path: string): void {
  useDiagramHost.setState((s) => ({ seen: s.seen.filter((p) => p !== path) }));
}

/** With the draw.io plugin off there is no editor: says so, with the button that turns it on. True when it stopped the caller. */
export function refuseEditing(): boolean {
  if (!pluginOff("diagrams")) return false;
  useWorkspace.getState().toast("Turn on the draw.io plugin to edit this diagram", { label: "Turn on", run: () => void turnPluginOn("diagrams") });
  return true;
}

/** Opens the diagram in the editor over the window, without leaving the page, board or slide. */
export function editDiagram(path: string): void {
  if (!refuseEditing()) useDiagramHost.getState().openModal(path);
}

/** Opens the diagram in the editor over the window and resolves once that editor is closed (or another diagram took its place). */
export function editDiagramAndWait(path: string): Promise<void> {
  if (refuseEditing()) return Promise.resolve();
  return new Promise((resolve) => {
    useDiagramHost.getState().openModal(path);
    const stop = useDiagramHost.subscribe((state) => {
      if (state.modal === path) return;
      stop();
      resolve();
    });
  });
}
