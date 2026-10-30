// The window's own actions, always at the top right: the quick glance (the
// side stack, to look at other pages beside this one) and the chat. The chat
// button pulses a dot while a chat works and carries a count of those that
// finished or need you while you were elsewhere.

import { lazy, Suspense, useRef } from "react";

import { useUnread } from "../features/chat/unread";
import { useShell } from "../lib/store";
import { keyTitle } from "../features/shortcuts/store";
import { useWorkspace } from "../features/workspace/store";
import { IconButton } from "../ui/Button";
import { useChatBackground } from "./chat-background";
import { useRunningChats } from "./running-chats";

// The list of running chats loads when it first opens; the button only needs the counts the window already keeps.
const RunningChats = lazy(() => import("./RunningChats"));

export function GlobalActions() {
  const stackOpen = useWorkspace((s) => s.stackOpen);
  const chatOpen = useShell((s) => s.chatOpen);
  const { badge, describe } = useChatBackground();
  const working = useUnread((s) => s.working);
  const needs = useUnread((s) => Object.values(s.unseen).filter((o) => o === "needs").length);
  const running = useRunningChats((s) => s.open);
  const box = useRef<HTMLDivElement>(null);
  const runningButton = useRef<HTMLButtonElement>(null);
  const busy = working + needs;
  return (
    <div ref={box} className="relative flex shrink-0 items-center gap-0.5 self-center pl-1 pr-2">
      <IconButton
        icon="glance"
        label="Quick glance"
        title={keyTitle("Quick glance: find pages and keep them beside this one", "stack")}
        size="sm"
        active={stackOpen}
        onClick={() => useWorkspace.getState().toggleStack()}
      />
      {busy > 0 && (
        <IconButton
          ref={runningButton}
          icon="agent"
          label="Running chats"
          title={keyTitle(working > 0 ? `${working === 1 ? "A chat is" : `${working} chats are`} working. Show what is running` : "A chat stopped and needs you. Show what is running", "running-chats")}
          size="sm"
          active={running}
          aria-expanded={running}
          aria-haspopup="dialog"
          onClick={() => useRunningChats.getState().show()}
        />
      )}
      <IconButton
        icon="chat"
        label="Chat"
        title={keyTitle(describe ? `Chat about the pages open. ${describe}` : "Chat about the pages open", "chat-dock")}
        size="sm"
        active={chatOpen}
        badge={badge}
        aria-description={describe}
        onClick={() => useShell.getState().toggleChat()}
      />
      {running && (
        <Suspense fallback={null}>
          <RunningChats anchor={busy > 0 ? runningButton : box} />
        </Suspense>
      )}
    </div>
  );
}
