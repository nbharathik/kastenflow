// "When I switch pages" (Settings → AI → Chat panel). Keep this chat: nothing
// happens here. Use that page's chat: the dock shows the chat tied to the page
// in front, and a page without one gets a new chat that is tied when its first
// message is sent. Start a new chat: each page opened gets a fresh chat.

import { useEffect, useRef } from "react";

import { useWorkspace } from "../../workspace/store";
import type { ActiveTarget } from "../open-pages";
import { usePanelPrefs } from "../panel-prefs";
import { useChat } from "../store";
import { bindingOf } from "./target";

/** Acts on the page in front changing, as the setting says. The first page seen is not a switch, except that a tied chat is found for it. */
export function useSwitchMode(target: ActiveTarget | null): void {
  const mode = usePanelPrefs((s) => s.onSwitch);
  const last = useRef<string | null | undefined>(undefined);
  const run = useRef(0);
  const kind = target?.kind;
  const path = target?.path;

  useEffect(() => {
    const key = kind && path ? `${kind}:${path}` : null;
    const before = last.current;
    last.current = key;
    if (mode === "keep" || !kind || !path || key === before) return;
    const chat = useChat.getState();
    const current = chat.active ? chat.threads[chat.active] : undefined;

    if (mode === "new") {
      // The first page is where the chat began; an empty chat is new enough.
      if (before === undefined || (current && current.messages.length === 0)) return;
      chat.start({ open: true });
      return;
    }

    const mine = ++run.current;
    const binding = bindingOf({ kind, path }, useWorkspace.getState().notes);
    void (async () => {
      const found = await chat.ensure().threadFor(binding).catch(() => null);
      // Another page came to the front meanwhile: that one decides.
      if (mine !== run.current) return;
      const store = useChat.getState();
      if (found) {
        if (!store.threads[found.id] && !store.saved[found.id]) useChat.setState((s) => ({ saved: { ...s.saved, [found.id]: found } }));
        if (store.active !== found.id) store.open(found.id);
        return;
      }
      // No chat for this page yet: an empty one is used, else a new one; it is tied with its first message.
      const open = store.active ? store.threads[store.active] : undefined;
      const id = open && open.messages.length === 0 ? open.id : store.start({ open: true });
      store.bindWhenSent(id, binding);
    })();
  }, [mode, kind, path]);
}
