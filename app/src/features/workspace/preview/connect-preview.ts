// The in-browser preview's vault: the samples, or a synthetic vault to check
// speed with, kept in memory and in this browser's storage. Loaded only in a
// browser, so the desktop app never parses the preview's code or its files.

import { inDemo } from "../../../demo/flag";
import type { Connection } from "../vault";
import { bigBoard, bigBoardSize } from "./big-board";
import { bigVault, bigVaultSize } from "./big-vault";
import { MemoryVault, type PreviewStorage } from "./memory-vault";
import { PREVIEW_KEY } from "./fresh-start";
import { readStored } from "./stored";
import { devSources, loadDevSamples, loadSamples } from "./samples";

/** The preview's notes in this browser's storage, so edits survive reloads. */
export const browserStorage: PreviewStorage = {
  load: () => {
    try {
      const text = localStorage.getItem(PREVIEW_KEY);
      // Saved notes that cannot be read are set aside, not written over
      // by the fresh start.
      if (text && !readStored(text)) localStorage.setItem(`${PREVIEW_KEY}.unreadable`, text);
      return text;
    } catch {
      return null;
    }
  },
  save: (data) => {
    try {
      localStorage.setItem(PREVIEW_KEY, data);
    } catch {
      // Full or blocked storage: the preview keeps working in memory.
    }
  },
};

/** Forgets the preview's edits and starts again from the samples. */
export function resetPreview(): void {
  try {
    localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Nothing stored.
  }
}

export async function connectPreview(): Promise<Connection> {
  // `?big=10000` swaps in a synthetic vault, `?board=500` adds a synthetic
  // whiteboard and `?samples=dev` the dev vault's fuller samples, all kept
  // in memory only, to check speed, demo and take screenshots.
  const big = bigVaultSize(location.search);
  const board = bigBoardSize(location.search);
  const dev = new URLSearchParams(location.search).get("samples") === "dev";
  const samples = dev ? await loadDevSamples() : await loadSamples();
  const client = big || board || dev ? new MemoryVault({ ...samples, ...(big ? bigVault(big) : {}), ...(board ? bigBoard(board) : {}) }) : new MemoryVault(samples, browserStorage);
  if (dev) for (const [path, load] of devSources()) client.addSampleSource(path, load);
  // `?demo=1.2.2` puts canned stand-ins behind the real screens of the 1.2.2 promo video; its code loads only then.
  if (inDemo()) await (await import("../../../demo")).installDemo(client);
  return { client };
}
