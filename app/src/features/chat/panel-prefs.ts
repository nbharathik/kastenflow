// What the person chose for the chat panel in Settings → AI → Chat panel:
// whether selected text is added by itself, and what happens to the chat when
// they switch pages. Kept in this browser like the panel's width; stored
// values are checked, since anything may be there. (How many chats the list
// keeps and how many work at once are the backend's: chat_limits.)

import { create } from "zustand";

const KEY = "kasten.chat.panel";

/** "auto": a selection of 3 or more characters becomes a chip by itself. "manual": only "Add to chat" adds one. "never": selections are never offered. */
export type SelectedText = "auto" | "manual" | "never";

/** "keep": one chat, following the page. "bound": each page has its own chat. "new": a fresh chat for each page opened. */
export type OnSwitch = "keep" | "bound" | "new";

/** Where a link in a deck's assistant opens: "beside" the deck (the pane to its right), in a "tab" of its own, or "here", in the deck's own tab. */
export type AssistantLinks = "beside" | "tab" | "here";

export interface PanelPrefs {
  selectedText: SelectedText;
  onSwitch: OnSwitch;
  assistantLinks: AssistantLinks;
}

export const PANEL_DEFAULTS: PanelPrefs = { selectedText: "auto", onSwitch: "keep", assistantLinks: "beside" };

const SELECTED: readonly SelectedText[] = ["auto", "manual", "never"];
const SWITCH: readonly OnSwitch[] = ["keep", "bound", "new"];
const LINKS: readonly AssistantLinks[] = ["beside", "tab", "here"];

function read(): PanelPrefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const { selectedText, onSwitch, assistantLinks } = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
    return {
      selectedText: SELECTED.includes(selectedText as SelectedText) ? (selectedText as SelectedText) : PANEL_DEFAULTS.selectedText,
      onSwitch: SWITCH.includes(onSwitch as OnSwitch) ? (onSwitch as OnSwitch) : PANEL_DEFAULTS.onSwitch,
      assistantLinks: LINKS.includes(assistantLinks as AssistantLinks) ? (assistantLinks as AssistantLinks) : PANEL_DEFAULTS.assistantLinks,
    };
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

interface PanelState extends PanelPrefs {
  set(patch: Partial<PanelPrefs>): void;
}

export const usePanelPrefs = create<PanelState>()((set, get) => ({
  ...read(),
  set(patch) {
    set(patch);
    const { selectedText, onSwitch, assistantLinks } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ selectedText, onSwitch, assistantLinks }));
    } catch {
      // The choice then lasts until the window closes.
    }
  },
}));

/** Reads the stored choice again (a test, after the storage was changed). */
export function reloadPanelPrefs(): void {
  usePanelPrefs.setState(read());
}
