// Palette commands for the whiteboard in front, and for how boards look. The
// board's tools are keys on the board itself and its menus; these are the
// actions that are not (focus mode, presenting, the outline) and the switches
// that Settings → Whiteboards holds (the palette's own "Settings: Whiteboards"
// opens that group). The palette is on the start-up path and the board is not,
// so what a command does is loaded when it runs.

import type { Command } from "../workspace/overlays/commands";
import { useBoardPrefs } from "./board-prefs";
import { boardInFront } from "./canvas/active";
import type { BoardController } from "./canvas/state/controller";

const onBoard = () => Boolean(boardInFront());
const prefs = () => useBoardPrefs.getState();

/** Runs `action` on the board in front, loading it first. */
const withBoard = (action: (board: BoardController) => unknown) => () => {
  const board = boardInFront();
  if (board) void action(board);
};

export const BOARD_COMMANDS: Command[] = [
  {
    id: "board-focus",
    label: "Board: focus mode",
    words: "whiteboard hide bars toolbar chrome minimal quiet distraction free canvas only",
    when: onBoard,
    run: withBoard(async (board) => (await import("./canvas/state/focus")).toggleFocus(board)),
  },
  {
    id: "board-present",
    label: "Board: present its sections",
    words: "whiteboard slides talk fullscreen show slideshow",
    when: onBoard,
    run: withBoard(async (board) => (await import("./canvas/state/present")).present(board)),
  },
  {
    id: "board-outline",
    label: "Board: copy as an outline",
    words: "whiteboard export markdown text clipboard sections list",
    when: onBoard,
    run: withBoard(async (board) => (await import("./canvas/state/export")).copyOutline(board)),
  },
  {
    id: "board-minimap",
    label: "Boards: show or hide the minimap",
    words: "whiteboard map overview corner",
    run: () => prefs().set({ minimap: !prefs().minimap }),
  },
  {
    id: "board-toolbar",
    label: "Boards: always show the toolbar, or let it rest",
    words: "whiteboard tools strip faint quiet fade left",
    run: () => prefs().set({ alwaysToolbar: !prefs().alwaysToolbar }),
  },
  {
    id: "board-double-click",
    label: "Boards: double-click makes a card or a sticky",
    words: "whiteboard empty space switch",
    run: () => prefs().set({ doubleClick: prefs().doubleClick === "card" ? "sticky" : "card" }),
  },
];
