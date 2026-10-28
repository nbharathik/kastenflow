// What the editor's commands do to a deck, for the check that keeps the editor and the agent tools in step
// (`op-audit.test.ts`). The editor changes a deck only by applying slides-core operations, and the deck tools
// an agent has are made from the same list, so a command that changes the deck needs no entry of its own
// here: what has to be said is which commands never change it, and which operations the editor never applies.

/** Commands that never change the deck: looking, moving about, the clipboard, files made from it. */
export const UI_ONLY: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^view\./, why: "zoom, panels, density, the way the deck is shown, and starting the show" },
  { pattern: /^help\./, why: "the list of keys" },
  { pattern: /^lint\./, why: "opens the checks and the badges that show them" },
  { pattern: /^edit\.(copy|select-all|find)$/, why: "reads the selection or the deck (replacing is replace_all)" },
  { pattern: /^edit\.(undo|redo)$/, why: "steps of the editor's own history; an agent takes back a whole session" },
  { pattern: /^embed\.preview-live$/, why: "shows the page in the box for the person" },
  { pattern: /^insert\.select$/, why: "arms the pointer" },
  { pattern: /^slide\.(previous|next)$/, why: "moves to another slide" },
  { pattern: /^steps\.(next|previous)$/, why: "steps the preview" },
  { pattern: /^table\.select(-cells)?$/, why: "selects cells" },
  { pattern: /^page\.open$/, why: "opens the page a slide was made from" },
  { pattern: /^text\.paint-copy$/, why: "copies a look to paste later" },
  { pattern: /^deck\.save-template$/, why: "writes a template file; the deck is not changed" },
  { pattern: /^file\.(print|export-.+)$/, why: "makes a file from the deck (the export tool for an agent)" },
];

/** The first part of the id of every command that changes the deck, through an operation. */
export const DECK_PREFIXES: readonly string[] = ["arrange", "text", "slide", "table", "steps", "insert", "format", "layout", "deck", "page", "agent", "edit", "file", "embed"];

/**
 * The operations the editor never applies by name, and why. The operation is still one an agent can use
 * (a tool of its own, or listed as left out with its reason in the MCP server's deck tools), so a change
 * the editor makes by another operation is reachable too. A new operation must be applied by the editor
 * or named here.
 */
export const NOT_APPLIED_BY_THE_EDITOR: Readonly<Record<string, string>> = {
  add_diagram: "the editor draws a diagram in the draw.io window and puts it on the slide as a picture (add_elements); an agent lays out boxes and arrows",
  replace_deck: "for a host that loads a whole deck at once; the editor opens a deck rather than replacing its slides",
  format_paragraphs: "the editor changes lists and alignment with the text commands, which save as set_rich_text",
  add_storyboard_slides: "applied by the app's storyboard (Present, Storyboard), not by the package",
};
