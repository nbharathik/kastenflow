// The editor's extensions: the `stex` mode, line numbers, folding by heading,
// bracket matching, search, history, the token colours and the app's theme.
// Build keys (Ctrl/Cmd+Enter, Ctrl/Cmd+S) run before anything else. The
// theme sits in a compartment so a switch of light and dark is one
// reconfiguration, not a new editor. Other parts add extensions through
// `extensions.ts`.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";

import { codemirrorTheme } from "../../../ui/codemirror-theme";
import { extensions } from "./extensions";
import { foldByHeading } from "./fold";
import { texHighlight } from "./highlight";

/** What the editor tells its owner. Read when it happens, so the owner may change it. */
export interface EditorHooks {
  /** The text changed. */
  change(text: string): void;
  /** Ctrl/Cmd+Enter. */
  build(): void;
  /** Ctrl/Cmd+S. */
  save(): void;
}

export const themeSlot = new Compartment();

/** The theme as the page is drawn now. */
export const currentTheme = (): Extension => themeSlot.of(codemirrorTheme());

const language = StreamLanguage.define(stex);

/** A state for the text of one file. */
export function createState(doc: string, hooks: () => EditorHooks, label: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      Prec.high(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              hooks().build();
              return true;
            },
          },
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              hooks().save();
              return true;
            },
          },
        ]),
      ),
      lineNumbers(),
      foldGutter(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      language,
      foldByHeading,
      texHighlight,
      keymap.of([...searchKeymap, ...foldKeymap, ...historyKeymap, ...defaultKeymap]),
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) hooks().change(update.state.doc.toString());
      }),
      currentTheme(),
      ...extensions,
    ],
  });
}
