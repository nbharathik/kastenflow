// What the window's Chat button says about the chats that work or finished
// out of sight. The numbers come from a small store (features/chat/unread.ts)
// that does not load the chat. In the app the chat is brought up once the
// window is idle, so a chat that worked while the app was closed, or still
// works, shows on the button without opening the dock.

import { useEffect } from "react";

import { unreadCount, useUnread } from "../features/chat/unread";
import { inTauri } from "../lib/api";
import type { IconBadge } from "../ui/Button";

/** Brings the chat up (it lists the saved chats and picks up those that still work). */
function bringUpChat(): void {
  void import("../features/chat/store").then(({ useChat }) => useChat.getState().loadSaved());
}

export function useChatBackground(): { badge: IconBadge | null; describe: string | undefined } {
  useEffect(() => {
    if (!inTauri()) return;
    // Not on the way to the first screen: when the window has nothing better to do.
    const idle = typeof requestIdleCallback === "function" ? requestIdleCallback(bringUpChat, { timeout: 4000 }) : (setTimeout(bringUpChat, 1500) as unknown as number);
    return () => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(idle) : clearTimeout(idle));
  }, []);
  const working = useUnread((s) => s.working);
  const waiting = useUnread(unreadCount);
  // What needs a look comes before what is still going on.
  if (waiting > 0) return { badge: { kind: "count", count: waiting }, describe: waiting === 1 ? "A chat finished or needs you" : `${waiting} chats finished or need you` };
  if (working > 0) return { badge: { kind: "working" }, describe: working === 1 ? "A chat is working" : `${working} chats are working` };
  return { badge: null, describe: undefined };
}
