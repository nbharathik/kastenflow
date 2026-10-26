// Helpers for the table's selection, order and paste tests: the preview vault
// takes batches only in the desktop app, so a test swaps in one that records
// what it is given (and keeps a new row order, as the core does), plus ways to
// read the notices and run their Undo.

import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import type { BatchChange, BatchRun } from "../../../../lib/vault/batch-types";
import type { TagView } from "../../../../lib/vault/types";
import type { MemoryVault } from "../../../workspace/preview/memory-vault";
import { useWorkspace } from "../../../workspace/store";

export function fakeBatch(vault: MemoryVault) {
  const runBatch = vi.fn(async (changes: BatchChange[]): Promise<BatchRun> => {
    for (const change of changes) {
      if (change.kind !== "set_view_order") continue;
      const schema = (await vault.tagSchemas()).find((s) => s.name === change.tag)!;
      const views = schema.views as unknown as TagView[];
      await vault.setTagViews(
        schema.name,
        views.map((v) => (v.name === change.view ? { ...v, order: change.ids as string[] } : v)),
      );
    }
    return { changes: changes.length, results: [], commit: "c1" };
  });
  const undoCommit = vi.fn(async () => ({ reverted: [], conflict: null }));
  vault.runBatch = runBatch;
  vault.undoCommit = undoCommit;
  return { runBatch, undoCommit };
}

/** The notices on screen, oldest first. */
export const toasts = () => useWorkspace.getState().toasts.map((t) => t.text);

/** The newest notice's button (its Undo, say). */
export const toastAction = () => useWorkspace.getState().toasts.at(-1)?.action;

/** Presses a key on the grid. */
export const press = (grid: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid, { key, ...init });

/** Pastes text on the grid, as the clipboard would hand it over. */
export const paste = (grid: HTMLElement, text: string) => fireEvent.paste(grid, { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") } });

/** A stand-in for the browser's drag data. */
export function dragData() {
  const data: Record<string, string> = {};
  return {
    types: [] as string[],
    effectAllowed: "",
    dropEffect: "",
    setData(type: string, value: string) {
      data[type] = value;
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData: (type: string) => data[type] ?? "",
  };
}
