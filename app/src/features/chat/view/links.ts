// Where a chat opens what it links to. In the Chat view and the window's
// chat dock a link opens in place, as links do elsewhere (the dock stays
// beside it). Ctrl, Shift and Alt choose as everywhere (a tab, the side
// stack, a split).

import { createContext, useContext } from "react";

import { showSession } from "../../review/session-request";
import { useWorkspace, type OpenHow, type Place } from "../../workspace/store";

export type Variant = "full" | "dock";

/** A narrow chat beside other things: the dock. */
export const isNarrow = (variant: Variant) => variant === "dock";

export interface ChatLinks {
  variant: Variant;
  openTitle(title: string, how?: OpenHow): void;
  openPath(path: string, how?: OpenHow): void;
  go(place: Place): void;
  /** History, open on one agent session. */
  showSession(session: string): void;
}

/**
 * The links of a chat. `usually` is where a plain click opens what the chat links to (Ctrl, Shift and Alt still choose): "here" unless the
 * place that shows the chat is a document that a link must not take over (a deck's assistant tab).
 */
export function linksFor(variant: Variant, usually: OpenHow = "here"): ChatLinks {
  // A plain click asks for "here" (no key held): that is the usual place. Ctrl, Shift and Alt still choose.
  const way = (how: OpenHow | undefined): OpenHow => (how === undefined || how === "here" ? usually : how);
  return {
    variant,
    openTitle: (title, how) => void useWorkspace.getState().openTitle(title, way(how)),
    openPath: (path, how) => useWorkspace.getState().openPath(path, way(how)),
    go: (place) => useWorkspace.getState().go(place, usually),
    showSession: (session) => showSession(session),
  };
}

export const LinksContext = createContext<ChatLinks>(linksFor("full"));

export const useChatLinks = () => useContext(LinksContext);
