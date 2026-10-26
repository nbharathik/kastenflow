// The demo answers the desktop app's commands for the few features that call
// them directly (backup, Sign in with ChatGPT). The window's own `invoke` and
// `listen` are the real ones: only the other end is replaced, with a table of
// canned answers. A command the table lacks fails the way it does in a plain
// browser, so nothing else in the preview changes.

import { emit } from "@tauri-apps/api/event";

export type Handler = (args: Record<string, unknown>) => unknown;

const table = new Map<string, Handler>();
let installed = false;

/** Adds commands to the table. */
export function addCommands(commands: Record<string, Handler>): void {
  for (const [name, handler] of Object.entries(commands)) table.set(name, handler);
}

/** Starts answering the window's commands and events (once). */
export async function installIpc(): Promise<void> {
  if (installed) return;
  installed = true;
  const { mockIPC } = await import("@tauri-apps/api/mocks");
  mockIPC(
    (command, args) => {
      const handler = table.get(command);
      if (!handler) throw new Error(`${command} needs the desktop app`);
      return handler((args ?? {}) as Record<string, unknown>);
    },
    { shouldMockEvents: true },
  );
}

/** Tells every listener of `event` in this window, as the desktop app does. */
export async function emitEvent(event: string, payload: unknown): Promise<void> {
  await emit(event, payload);
}
