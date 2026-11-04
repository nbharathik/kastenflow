import { codePictures, selectedCodePicture } from "../code-picture/model.ts";
import { runAll, runAllWords } from "../code-picture/run.ts";
import { setTarget } from "../code-picture/target.ts";
import type { Command } from "./types.ts";

/**
 * Code pictures: put one on the slide from a starting point, edit the code of the selected one, and run every code picture of the deck
 * again. All need a host that runs code (`runGenerator`); the changes are the ordinary operations on the picture, one step of undo.
 */
export const codePictureCommands: Command[] = [
  {
    id: "insert.code-picture",
    label: "Code picture…",
    icon: "code",
    enabled: (_state, _ui, host) => host.runGenerator !== undefined,
    run: ({ ui }) => {
      setTarget(ui, { kind: "new" });
      ui.openDialog("code-picture");
    },
  },
  {
    id: "edit.code-picture",
    label: "Edit code",
    icon: "code",
    enabled: (state, _ui, host) => host.runGenerator !== undefined && selectedCodePicture(state) !== undefined,
    run: ({ session, ui }) => {
      const picked = selectedCodePicture(session.state);
      if (!picked) return;
      setTarget(ui, { kind: "edit", slideId: picked.slideId, id: picked.id });
      ui.openDialog("code-picture");
    },
  },
  {
    id: "deck.run-code-pictures",
    label: "Run all code pictures",
    icon: "refresh-cw",
    enabled: (state, _ui, host) => host.runGenerator !== undefined && codePictures(state.deck).length > 0,
    run: async ({ session }) => {
      const report = await runAll(session);
      session.host.notify?.(runAllWords(report));
    },
  },
];
