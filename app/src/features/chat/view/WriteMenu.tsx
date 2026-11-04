// The chat's "…" menu: how its writes reach your notes. Ask first, Apply
// directly or Auto, remembered with the thread. Tucked away: only a choice
// that is not the default shows as a small label beside it. The agent mode
// (Review everything, Autonomous agents) decides before this does, and the
// menu says so.

import "../review/chat-review.css";

import { useAgentMode } from "../../agents/store";
import { Menu } from "../../../shell/Menu";
import type { MenuEntry } from "../../../shell/menu-types";
import { Icon } from "../../../ui/Icon";
import { useWorkspace } from "../../workspace/store";
import { isAgentProvider } from "../agents/names";
import { useChat } from "../store";
import type { Thread } from "../thread";
import { WRITE_CHOICES, heldByMode, writeChoiceOf, writeLabel } from "../writes";
import { useChatLinks } from "./links";
import { useSessionUi } from "./session-ui";

const HINTS = { ask: "Waits for you", direct: "Saved now", auto: "Small ones saved" } as const;

export function WriteMenu({ thread }: { thread: Pick<Thread, "id" | "direct" | "auto" | "streaming" | "changed" | "session" | "undone"> & Partial<Pick<Thread, "provider">> }) {
  const links = useChatLinks();
  // Read so the menu draws again when the mode changes.
  useAgentMode((s) => s.view);
  const held = heldByMode();
  const choice = writeChoiceOf(thread);
  const label = writeLabel(thread, held);
  const entries: MenuEntry[] = [
    { heading: held === "review" ? "Review everything is on: changes wait" : held === "autonomous" ? "Autonomous agents are on: changes are saved" : "When the chat changes your notes" },
    ...WRITE_CHOICES.map(({ choice: each, label: name }) => ({
      label: name,
      hint: HINTS[each],
      checked: choice === each,
      onSelect: () => {
        if (held) return useWorkspace.getState().toast(held === "review" ? "Review everything is on, so changes wait for you whatever is chosen here" : "Autonomous agents are on, so changes are saved as the chat makes them");
        useChat.getState().setWrites(thread.id, each);
      },
    })),
  ];
  // What the chat changed stays reachable here when its chip under the thread is hidden.
  // (Not for a coding agent: it changes notes in a session of its own, which History lists.)
  if (thread.changed && thread.session && !isAgentProvider(thread.provider)) {
    const session = thread.session;
    entries.push("divider");
    if (!thread.undone && !thread.streaming) entries.push({ label: "Undo this chat's changes", icon: <Icon name="undo" className="size-4" />, onSelect: () => useSessionUi.getState().askUndo(thread.id) });
    entries.push({ label: "See in History", icon: <Icon name="history" className="size-4" />, onSelect: () => links.showSession(session) });
  }
  return (
    <span className="kasten-chat-write">
      {label && (
        <span className="kasten-chat-write-label" title={WRITE_CHOICES.find((c) => c.choice === choice)?.says}>
          {label}
        </span>
      )}
      <Menu label="Chat options" buttonClass="kasten-chat-icon-button" items={entries}>
        <Icon name="more" className="size-4" />
      </Menu>
    </span>
  );
}
