// Under a chat's name: the page, deck, diagram or document it is tied to, with
// "Unbind" and "Bind to this page" in its menu. A tied chat is the one the
// panel shows when that page comes to the front (Settings → AI → Chat panel,
// "When I switch pages"). A chat with no tie and nothing to tie it to shows
// nothing.

import "../history.css";

import { Menu, type MenuEntry } from "../../../shell/Menu";
import { Icon } from "../../../ui/Icon";
import { useWorkspace } from "../../workspace/store";
import { bindingOf, bindingTitle } from "../binding/target";
import { useActiveTarget, type ActiveTarget } from "../open-pages";
import { useChat } from "../store";
import type { Thread } from "../thread";

const NOUN: Record<ActiveTarget["kind"], string> = { page: "page", deck: "deck", board: "whiteboard", diagram: "diagram", latex: "document" };

export function BindChip({ thread }: { thread: Thread }) {
  const notes = useWorkspace((s) => s.notes);
  const target = useActiveTarget();
  const { bound } = thread;
  const items: MenuEntry[] = [];
  // Tie it to what is in front, unless it is tied to that already.
  const here = target ? bindingOf(target, notes) : null;
  const same = Boolean(bound && here && bound.kind === here.kind && (bound.id && here.id ? bound.id === here.id : bound.path === here.path));
  if (here && target && !same) items.push({ label: `Bind to this ${NOUN[target.kind]}`, icon: <Icon name="link" className="size-4" />, onSelect: () => void useChat.getState().bind(thread.id, here) });
  if (bound) items.push({ label: `Unbind from ${bindingTitle(bound, notes)}`, onSelect: () => void useChat.getState().unbind(thread.id) });
  if (items.length === 0) return null;
  const name = bound ? bindingTitle(bound, notes) : null;
  return (
    <span className="kasten-chat-bind" data-bound={bound ? "true" : undefined}>
      <Menu label={name ? `Tied to ${name}` : "Tie this chat to a page"} align="left" items={items}>
        <Icon name="link" className="size-3" />
        {name && <span className="kasten-chat-bind-name">{name}</span>}
      </Menu>
    </span>
  );
}
