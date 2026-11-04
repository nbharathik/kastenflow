// What the window asks the app for when it runs code. Every command here is the window's own: a frame can call none.

import { invoke } from "@tauri-apps/api/core";

/** The commands that begin and end the sandbox's frame. */
export interface GeneratorBackend {
  /** A new frame's secret: it is in every address the frame loads from, and nothing is served without it. */
  openFrame(): Promise<string>;
  closeFrame(frame: string): Promise<void>;
}

export const tauriGeneratorBackend: GeneratorBackend = {
  openFrame: () => invoke<string>("generator_frame_open"),
  // The same command that ends a smart page's frame: the secret is the same kind of thing.
  closeFrame: (frame) => invoke<void>("smart_frame_close", { frame }),
};

/** Whether a person allowed this code (its `hash`) to run in the deck at `deck` (a vault path). */
export const generatorAllowed = (deck: string, hash: string): Promise<boolean> => invoke<boolean>("generator_allowed", { deck, hash });

/** A person's "Allow to run" for this code (its `hash`) in the deck, for good. Other code in the deck asks again. */
export const allowGenerator = (deck: string, hash: string): Promise<void> => invoke<void>("generator_allow", { deck, hash });

/** A text file of the vault's `assets/` (a CSV) for the code to read. */
export const textAsset = (path: string): Promise<string> => invoke<string>("generator_text_asset", { path });

/** What the library keeps, as the app lists it. */
export interface LibraryInfo {
  path: string;
  id: string;
  label: string;
  language: string;
  output: string;
  problem: string | null;
}

export const libraryList = (): Promise<LibraryInfo[]> => invoke<LibraryInfo[]>("generator_library");
export const libraryRead = (path: string): Promise<{ text: string }> => invoke<{ text: string }>("generator_library_read", { path });
export const librarySave = (text: string): Promise<{ path: string; replaced: boolean }> => invoke<{ path: string; replaced: boolean }>("generator_library_save", { text });

/** Answers the app's question or request `id`: `text` is the answer, `error` says why there is none. */
export const answerApp = (id: string, answer: { text: string } | { error: string }): Promise<unknown> =>
  invoke("diagram_png_answer", "text" in answer ? { id, png: answer.text } : { id, error: answer.error });
