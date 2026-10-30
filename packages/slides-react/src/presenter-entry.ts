// What the presenter's window needs from this package, and nothing else: the speaker's view and the links that join it to the
// window that presents. A narrow entry of its own so that this window does not load the editor, the exports or the text engine.

export { PresenterWindow } from "./present/PresenterWindow.tsx";
export type { PresenterWindowProps } from "./present/PresenterWindow.tsx";
export { localRehearsals } from "./present/rehearsal-store.ts";
export type { RehearsalStore } from "./present/rehearsal-store.ts";
export type { RehearsalRecord } from "./present/rehearsal.ts";
export { broadcastSync } from "./present/sync.ts";
export type { PresentSync } from "./present/sync.ts";
export { linkOver } from "./present/wire.ts";
