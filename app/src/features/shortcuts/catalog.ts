// The commands keys can run, in the order Settings and the shortcut sheet
// list them.

import { allCommands } from "../workspace/overlays/commands";
import { isMac } from "./keymap";

/** Commands only keys run; the palette has no row for them. */
const KEY_ONLY: Record<string, string> = {
  palette: "Search and commands",
  back: "Back",
  forward: "Forward",
  "next-tab": "Next tab",
  "prev-tab": "Previous tab",
  "toggle-properties": "Fold or unfold this page's properties",
};

export const KEY_SECTIONS: { title: string; ids: string[] }[] = [
  {
    title: "Anywhere",
    ids: ["palette", "new-page", "new-card", "journal", "prev-day", "next-day", "search", "chat-dock", "chat-add-selection", "chat-focus", "chat-copy-answer", "back", "forward", "sidebar", "panel", "page-history", "focus", "theme", "zoom-in", "zoom-out", "zoom-reset", "save", "shortcuts"],
  },
  { title: "Tabs and panes", ids: ["new-tab", "close-tab", "reopen-tab", "pin-tab", "next-tab", "prev-tab", "split", "open-right", "stack", "stack-page"] },
  { title: "Go to", ids: ["home", "inbox", "captures", "journal-page", "projects", "library", "tasks", "calendar", "tags", "collections", "boards", "slides", "diagrams", "highlights", "references", "triage", "review-daily", "review-weekly", "graph", "graph-page", "project-overview", "browser", "browser-address", "chat", "history", "review", "trash", "settings"] },
  { title: "Make and change", ids: ["templates", "kits", "new-project", "new-collection", "new-board", "new-deck", "slide-numbers-off", "new-diagram", "browser-capture-page", "browser-capture-selection", "browser-save-paper", "extension-pair", "calendar-subscribe", "import-pdf", "import-notes", "export-project", "save-project-setup", "backup-setup", "backup-now", "backup-latest", "backup-github", "rename-page", "lock-page", "move", "move-up", "move-down", "duplicate", "favourite-page", "pin-page", "sidebar-cards", "copy-link", "copy-markdown", "reveal-page", "trash-page", "markdown", "full-width", "wide-pages", "agent-tint", "print", "fold-sections", "unfold-sections", "toggle-properties", "fold-properties", "unfold-properties", "fold-properties-all", "present-page", "smart-layout", "smart-page-layout", "smart-page-flip", "smart-page-history", "smart-new", "smart-turn-into", "smart-back", "smart-edit-code", "smart-save-template", "smart-export-html", "smart-improve", "smart-fix-errors", "smart-present", "sections-deck", "peek-page", "page-opens", "save-template", "page-mind-map", "ask-page", "project-home", "project-template", "project-smart-vault", "project-smart-on", "project-smart-off", "page-comments", "highlight-selection", "add-paper", "insert-citation", "compare-papers"] },
  { title: "Boards", ids: ["board-focus", "board-present", "board-outline", "board-minimap", "board-toolbar", "board-double-click"] },
  { title: "Agents", ids: ["agents-review", "agents-balanced", "agents-autonomous", "agents-today", "running-chats"] },
];

/** A command's name as the palette shows it. */
export function commandLabel(id: string): string {
  return KEY_ONLY[id] ?? allCommands().find((c) => c.id === id)?.label ?? id;
}

/** Keys the page editor uses, written for this system: ⌘ and ⌥ on macOS. */
export function editorKeys(text: string): string {
  return isMac() ? text.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧") : text;
}
