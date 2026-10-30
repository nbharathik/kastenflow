// What an agent can do of what a person does to a page, a whiteboard or a smart page, action by action.
// `agent-parity.test.ts` reads the menus and fails when one has an item this table does not know, so a
// new slash entry or page menu row cannot ship without someone saying whether an agent has it too.
// A Rust test (in the MCP server's crate) checks that every tool named after "tool exists:" is a real one.
//
// A value is one of
//   "tool exists: a, b; note"  the tools (comma and space between, then an optional note after a semicolon)
//   "UI only: why"             nothing for an agent to do: looking, moving about, the clipboard, a choice that is the person's
//   "gap: why"                 a person can, an agent cannot yet and it needs a decision before it is built; keep this list short

export type Parity = string;

const EDIT = "tool exists: edit_page, read_page_blocks";

/** The slash menu (`menus/catalog.ts`), by choice key. The colour choices share the key `colour`. */
export const SLASH: Readonly<Record<string, Parity>> = {
  text: EDIT,
  h1: EDIT,
  h2: EDIT,
  h3: EDIT,
  bullet: EDIT,
  numbered: EDIT,
  todo: "tool exists: edit_page, set_task",
  toggle: "tool exists: edit_page; the toggle step",
  page: "tool exists: create_note, set_parent",
  quote: EDIT,
  divider: EDIT,
  callout: "tool exists: edit_page; the callout step",
  link: "tool exists: edit_page; a [[Title]] in the text",
  image: "tool exists: add_asset, edit_page",
  embed: "tool exists: edit_page; the embed step",
  file: "gap: attaching a file that is not a picture (a PDF, a spreadsheet)",
  code: EDIT,
  "columns-2": "tool exists: edit_page; the wrap_columns step",
  "columns-3": "tool exists: edit_page; the wrap_columns step",
  table: "tool exists: edit_page; the table steps",
  math: EDIT,
  "inline-equation": EDIT,
  "table-view": "tool exists: edit_page, query_tag; an embed of the tag's view",
  "kanban-view": "tool exists: edit_page, query_tag; an embed of the tag's view",
  "list-view": "tool exists: edit_page, query_tag; an embed of the tag's view",
  "gallery-view": "tool exists: edit_page, query_tag; an embed of the tag's view",
  "calendar-view": "tool exists: edit_page, query_tag; an embed of the tag's view",
  database: "tool exists: edit_page, set_tag_views; an embed of the tag's view",
  "ask-ai": "UI only: opens the assistant panel; an outside agent is the assistant",
  "continue-ai": "UI only: opens the assistant panel; an outside agent is the assistant",
  "summarize-ai": "UI only: opens the assistant panel; an outside agent is the assistant",
  template: "tool exists: apply_template, list_templates",
  board: "tool exists: edit_page, create_board; an embed of the board",
  deck: "tool exists: edit_page, create_deck; an embed of the deck",
  citation: "tool exists: edit_page, list_references; [@key] in the text",
  "smart-page": "tool exists: set_note_meta; layout sections",
  colour: "tool exists: edit_page; the same span the editor writes around the words",
};

/** Choices a plugin adds to the slash menu while it is on (not read from the menu, which has them only then). */
export const SLASH_PLUGINS: Readonly<Record<string, Parity>> = {
  diagram: "tool exists: edit_page, diagram_new; an embed of the diagram",
};

/** The page menu ("Page options"), by the row's label. */
export const PAGE_MENU: Readonly<Record<string, Parity>> = {
  "Copy link": "UI only: copies [[Title]] to the clipboard; an agent writes the link in its text",
  "Open links from this page in…": "UI only: where a click opens a page",
  "Open in new tab": "UI only: windows and tabs",
  "Open in split view": "UI only: windows and tabs",
  "Open in side peek": "UI only: windows and tabs",
  Duplicate: "tool exists: duplicate_note",
  "Move to…": "tool exists: move_note",
  "Save as template": "tool exists: create_template; waits for review",
  "Lock for agents": "UI only: a page is locked and unlocked by a person only",
  "Unlock for agents": "UI only: a page is locked and unlocked by a person only",
  "Show Markdown file": "UI only: shows the file beside the page; read_note gives the text",
  "Hide Markdown file": "UI only: shows the file beside the page; read_note gives the text",
  "Sections layout": "tool exists: set_note_meta; layout sections",
  "Smart layout": "UI only: a person turns a page into a smart page; an agent makes one with smart_create after the person says yes",
  "Turn into smart page…": "UI only: a person turns an existing page into a smart page; an agent makes one with smart_create",
  "Edit code": "tool exists: smart_edit, smart_write_file",
  "Back to a normal page": "tool exists: set_note_meta; layout left out",
  "Save as smart template": "gap: keeping a smart page as a starter for new ones",
  "Export as HTML file": "UI only: writes a file outside the vault for the person",
  "Focus mode": "UI only: hides the chrome",
  "Fold all sections": "UI only: the way the page is shown",
  "Unfold all sections": "UI only: the way the page is shown",
  "Fold properties": "UI only: the way the page is shown",
  "Unfold properties": "UI only: the way the page is shown",
  "Tint what agents wrote": "UI only: the way the page is shown",
  "Mind map from this page": "tool exists: create_board, board_edit, connect; the map is built by hand",
  "Open mind map": "tool exists: read_board",
  "Present this page": "UI only: starts the show",
  "Turn sections into a deck": "tool exists: deck_from_note",
  "Copy as Markdown": "UI only: the clipboard; read_note gives the text",
  "Print or save as PDF": "UI only: makes a file for the person",
  "Show in folder": "UI only: opens the file manager",
  "Template for new pages…": "tool exists: update_props; the project page's page_template",
  "Change the template for new pages…": "tool exists: update_props; the project page's page_template",
  "New pages start blank": "tool exists: update_props; the project page's page_template",
  "Save as a setup…": "tool exists: save_project_setup; waits for review",
  "Use the vault's choice": "tool exists: request_smart_pages; the person decides",
  "On in this project": "tool exists: request_smart_pages; the person decides",
  "Off in this project": "UI only: switching smart pages on or off is the person's choice",
  "Hide project home": "UI only: the way the project is shown",
  "Show project home": "UI only: the way the project is shown",
  "Ask AI about this page": "UI only: opens the assistant panel",
  "Move to Trash": "tool exists: trash_note",
};

/** Rows plugins add to the page menu while they are on (not read from the menu). */
export const PAGE_MENU_PLUGINS: Readonly<Record<string, Parity>> = {
  "Send to LaTeX": "tool exists: latex_send_page",
};

/** The page's palette commands (`workspace/overlays/page-commands.ts`), by id. */
export const PAGE_COMMANDS: Readonly<Record<string, Parity>> = {
  "trash-page": "tool exists: trash_note",
  "rename-page": "tool exists: rename_note",
  "lock-page": "UI only: a page is locked and unlocked by a person only",
  "favourite-page": "UI only: a favourite is kept on this computer",
  "copy-link": "UI only: the clipboard",
  "copy-markdown": "UI only: the clipboard; read_note gives the text",
  "reveal-page": "UI only: opens the file manager",
  "pin-tab": "UI only: tabs and windows",
  "new-project": "tool exists: create_project",
  "present-page": "UI only: starts the show",
  "smart-layout": "tool exists: set_note_meta; layout sections",
  "smart-page-layout": "UI only: a person turns a page into a smart page",
  "smart-page-flip": "UI only: which side of a smart page is shown",
  "smart-page-history": "tool exists: get_history",
  "sections-deck": "tool exists: deck_from_note",
  "peek-page": "UI only: windows and tabs",
  "save-template": "tool exists: create_template; waits for review",
  "page-mind-map": "tool exists: create_board, board_edit, connect",
  "ask-page": "UI only: opens the assistant panel",
  "page-opens": "UI only: where a click opens a page",
  "project-home": "UI only: the way the project is shown",
  "project-template": "tool exists: update_props; the project page's page_template",
  "project-smart-vault": "tool exists: request_smart_pages; the person decides",
  "project-smart-on": "tool exists: request_smart_pages; the person decides",
  "project-smart-off": "UI only: switching smart pages on or off is the person's choice",
  "fold-properties": "UI only: the way the page is shown",
  "unfold-properties": "UI only: the way the page is shown",
  "fold-properties-all": "UI only: the way the page is shown",
  "agent-tint": "UI only: the way the page is shown",
  "page-comments": "tool exists: add_comment, list_comments, resolve_comment",
  "highlight-selection": "UI only: a person's own reading mark on a page kept from the web; add_comment with a quote points at words",
};

/** The block menu and the bar over a selected text (`menus/block-menu.ts`, `menus/toolbar.ts`), by label. */
export const BLOCK_MENU: Readonly<Record<string, Parity>> = {
  "Turn into": EDIT,
  Colour: "tool exists: edit_page; the same span the editor writes around the words",
  "Group into toggle": "tool exists: edit_page; the toggle step",
  Duplicate: "tool exists: edit_page; insert a copy of the block's text after it",
  Delete: "tool exists: edit_page; the delete step (the page can be put back from its history)",
  "Copy link to this location": "UI only: the clipboard",
  "Block menu": "UI only: the name of the menu",
  Underline: EDIT,
  "Ask AI": "UI only: opens the assistant panel",
  Explain: "UI only: opens the assistant panel",
  "Add to chat": "UI only: the assistant panel; get_selection tells an agent what is selected",
};

/** What the page's header and its properties let a person change. Written by hand: there is no list in the code to read. */
export const HEADER: Readonly<Record<string, Parity>> = {
  title: "tool exists: rename_note",
  "icon, cover, font, width, text size": "tool exists: set_note_meta",
  tags: "tool exists: add_tags, remove_tags",
  "properties (add, change, remove)": "tool exists: update_props",
  "property types and a tag's views": "tool exists: update_tag_schema, set_tag_views",
  "sub-pages and their order": "tool exists: set_parent, reorder_children",
  "project status and next action": "tool exists: set_project_state",
  "comments on words or a section": "tool exists: add_comment, resolve_comment",
  "to-dos": "tool exists: set_task, list_tasks",
  "the page's history": "tool exists: get_history, undo_session",
  "a day of the journal": "tool exists: journal_day, journal_append",
  "lock": "UI only: a page is locked and unlocked by a person only",
};

/** The whiteboard's selection bar (`BarAction`) and tools (`Tool`), by name. */
export const BOARD: Readonly<Record<string, Parity>> = {
  colour: "tool exists: board_edit; the restyle step",
  size: "tool exists: board_edit; the card_size step",
  open: "UI only: opens the note",
  fold: "tool exists: board_edit; the collapse step",
  ungroup: "tool exists: board_edit; the remove step takes a section off and its cards stay",
  align: "tool exists: board_edit; the move step with the positions worked out",
  group: "tool exists: group_on_board",
  remove: "tool exists: board_edit; the remove step (many at once wait for review)",
  more: "UI only: opens a menu of the same actions",
  select: "UI only: the pointer tool",
  hand: "UI only: the pointer tool",
  draw: "UI only: a stroke drawn by hand; an agent draws with shapes, arrows and stickies",
  erase: "UI only: rubs out strokes; the remove step takes a node off",
  connect: "tool exists: connect",
  shape: "tool exists: board_edit; the add_shape step",
};

/** The board commands (`boards/commands.ts`), by id. */
export const BOARD_COMMANDS: Readonly<Record<string, Parity>> = {
  "board-focus": "UI only: hides the chrome",
  "board-present": "UI only: starts the show",
  "board-outline": "UI only: the clipboard; read_board gives the nodes",
  "board-minimap": "UI only: the way the board is shown",
  "board-toolbar": "UI only: the way the board is shown",
  "board-double-click": "UI only: a preference",
};

/** A value that says what it must (see the top of this file). */
export const SHAPE = /^(tool exists: [a-z_]+(, [a-z_]+)*(; .+)?|UI only: .{12,}|gap: .{12,})$/;

/** The tool names a value lists. */
export function toolsOf(value: Parity): string[] {
  const match = /^tool exists: ([^;]+)/.exec(value);
  return match ? match[1]!.split(", ") : [];
}
