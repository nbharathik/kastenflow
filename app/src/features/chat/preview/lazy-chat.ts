// The browser preview's chat stand-in, loaded when it is first used. The
// desktop app never asks for it, so its canned replies (and the slide engine
// they edit decks with) stay out of the code the window loads first.

import type { VaultClient } from "../../../lib/vault/types";
import type { ChatClient } from "../client";

type Call = Omit<ChatClient, "kind" | "onEvent">;

export function lazyPreviewChat(vault: () => VaultClient | null): ChatClient {
  let loaded: Promise<ChatClient> | null = null;
  const real = () => (loaded ??= import("./fake-chat").then((m) => m.previewChat(vault)));
  /** The call, made on the stand-in once it is there. */
  const later =
    <K extends keyof Call>(name: K): Call[K] =>
    ((...args: unknown[]) => real().then((chat) => (chat[name] as (...rest: unknown[]) => unknown)(...args))) as Call[K];

  return {
    kind: "preview",
    providers: later("providers"),
    saveProvider: later("saveProvider"),
    removeProvider: later("removeProvider"),
    confirmProvider: later("confirmProvider"),
    testProvider: later("testProvider"),
    listProviderModels: later("listProviderModels"),
    modelCapabilities: later("modelCapabilities"),
    testProviderDraft: later("testProviderDraft"),
    write: later("write"),
    stopWrite: later("stopWrite"),
    aiActions: later("aiActions"),
    runAction: later("runAction"),
    send: later("send"),
    stop: later("stop"),
    reset: later("reset"),
    rewind: later("rewind"),
    changes: later("changes"),
    applyChanges: later("applyChanges"),
    recalcChanges: later("recalcChanges"),
    discardChanges: later("discardChanges"),
    attach: later("attach"),
    attachment: later("attachment"),
    dropAttachment: later("dropAttachment"),
    continueTurn: later("continueTurn"),
    threads: later("threads"),
    load: later("load"),
    saveUi: later("saveUi"),
    state: later("state"),
    deleteThread: later("deleteThread"),
    budgets: later("budgets"),
    setBudgets: later("setBudgets"),
    diagnostics: later("diagnostics"),
    clearDiagnostics: later("clearDiagnostics"),
    save: later("save"),
    brainstorm: later("brainstorm"),
    // Listens once the stand-in is there; that happens before any call made after this one reaches it.
    onEvent(listener) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void real().then((chat) => {
        if (!stopped) stop = chat.onEvent(listener);
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}
