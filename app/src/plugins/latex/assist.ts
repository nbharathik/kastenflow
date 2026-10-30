// What this part adds to the LaTeX editor, through `editor/extensions.ts`:
// completion, the build's marks in the gutter, and Ctrl/Cmd+click to show a
// line in the PDF. `installAssist()` is called once by the workspace; editors
// made after it have all of it. What the extensions need from the open document
// (its index, its folder) comes from `completion/binding.ts`.

import { autocompletion } from "@codemirror/autocomplete";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { assist } from "./completion/binding";
import { argumentSource, commandSource } from "./completion/sources";
import { addEditorExtension } from "./editor/extensions";
import "./inline/inline.css";
import { inlineAi } from "./inline/panel";
import { buildMarks } from "./lint";

/** Ctrl/Cmd+click on a line: the caret goes there and the line is shown in the PDF. */
const clickToPdf = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const bound = assist.current;
    const path = bound?.currentFile();
    if (at === null || !bound || !path) return false;
    view.dispatch({ selection: EditorSelection.cursor(at) });
    bound.syncToPdf(path, view.state.doc.lineAt(at).number);
    return true;
  },
});

const syncKey = Prec.high(
  keymap.of([
    {
      key: "Mod-Alt-j",
      preventDefault: true,
      run: (view) => {
        const bound = assist.current;
        const path = bound?.currentFile();
        if (!bound || !path) return false;
        bound.syncToPdf(path, view.state.doc.lineAt(view.state.selection.main.head).number);
        return true;
      },
    },
  ]),
);

let installed = false;

/** Adds the part's extensions to every editor made from now on (once). */
export function installAssist(): void {
  if (installed) return;
  installed = true;
  addEditorExtension([
    autocompletion({ override: [commandSource, argumentSource], icons: false, maxRenderedOptions: 60, activateOnTypingDelay: 40 }),
    buildMarks,
    inlineAi,
    clickToPdf,
    syncKey,
  ]);
}
