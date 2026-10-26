// The palette's commands for making and changing smart pages. Their code is
// loaded when one is used, so nothing here costs anything at start-up.

import type { NoteMeta } from "../../../lib/vault/types";
import { showSmartSide, toggleSmartPage } from "../../pages/present/actions";
import { pageFor } from "../../workspace/page/open-page";
import { usePageLayouts } from "../../workspace/page/page-layout";
import { openNote } from "../../workspace/overlays/page-commands";
import type { Command } from "../../workspace/overlays/commands";

/** Whether the page open in the focused pane is a smart page. */
function smartNote(): NoteMeta | undefined {
  const note = openNote();
  const session = note ? pageFor(note.path) : undefined;
  return note && session && usePageLayouts.getState().of.get(session)?.layout === "smart" ? note : undefined;
}

const flows = () => import("./flows");
const picker = () => import("./starter-picker");
const chat = () => import("../chat");

const WORDS = "smart page app live dashboard tracker";

export const SMART_AUTHOR_COMMANDS: Command[] = [
  {
    id: "smart-new",
    label: "New smart page",
    words: `${WORDS} create starter gallery map timeline`,
    run: () => void picker().then((m) => m.chooseStarter()),
  },
  {
    id: "smart-turn-into",
    label: "Turn this page into a smart page",
    words: `${WORDS} convert starter`,
    when: () => openNote() !== undefined && smartNote() === undefined,
    run: () => {
      const note = openNote();
      if (note) void picker().then((m) => m.chooseStarter({ turnInto: note.path }));
    },
  },
  {
    id: "smart-back",
    label: "Back to a normal page",
    words: `${WORDS} undo smart plain keep text`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) toggleSmartPage(note);
    },
  },
  {
    id: "smart-edit-code",
    label: "Edit this smart page's code",
    words: `${WORDS} html css javascript editor files`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) showSmartSide(note, "code");
    },
  },
  {
    id: "smart-save-template",
    label: "Keep this smart page as a template",
    words: `${WORDS} save starter your templates`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) void flows().then((m) => m.saveSmartTemplate(note.path, note.title));
    },
  },
  {
    id: "smart-export-html",
    label: "Save this smart page as an HTML file",
    words: `${WORDS} export share copy offline`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) void flows().then((m) => m.exportSmartHtml(note.path, note.title));
    },
  },
  {
    id: "smart-improve",
    label: "Improve this smart page's layout with AI",
    words: `${WORDS} arrange tidy chat ai layout`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) void chat().then((m) => m.improveLayout(note.path, note.title));
    },
  },
  {
    id: "smart-fix-errors",
    label: "Fix this smart page's errors with AI",
    words: `${WORDS} error broken repair chat ai`,
    when: () => smartNote() !== undefined,
    run: () => {
      const note = smartNote();
      if (note) void chat().then((m) => m.fixErrors(note.path, note.title));
    },
  },
  {
    id: "smart-present",
    label: "Present this smart page full screen",
    words: `${WORDS} fullscreen show screen`,
    when: () => smartNote() !== undefined,
    run: () => void flows().then((m) => m.togglePresentSmart()),
  },
];
