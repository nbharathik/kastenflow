// One CodeMirror view for the open file of a smart page: HTML, CSS or
// JavaScript by the file's ending. Each file keeps its own state (so undo stays
// with the file) while the editor is shown; the owner hears changes through
// `onChange`, and is told when Ctrl/Cmd+S asks to save at once. The text can
// be replaced from outside (the disk's file was chosen) by bumping `revision`.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { codemirrorTheme } from "../../../ui/codemirror-theme";
import { codeHighlight } from "./highlight";

/** The language for a file's ending; plain text for the rest. */
export function languageFor(path: string): Extension {
  const name = path.toLowerCase();
  if (name.endsWith(".html")) return html();
  if (name.endsWith(".css")) return css();
  if (name.endsWith(".js") || name.endsWith(".json")) return javascript();
  return [];
}

const themeSlot = new Compartment();

interface Props {
  /** The open file; switching it switches the state. */
  path: string;
  /** The text the file is first shown with. */
  initial: string;
  /** Changes when the text is replaced from outside; the editor then loads `initial` again. */
  revision: number;
  onChange(text: string): void;
  onSave(): void;
}

export function CodeEditor({ path, initial, revision, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, { state: EditorState; revision: number }>());
  const current = useRef<string | null>(null);
  const hooks = useRef({ onChange, onSave });
  hooks.current = { onChange, onSave };
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const created = new EditorView({ parent: host.current ?? undefined });
    view.current = created;
    const reflect = () => created.dispatch({ effects: themeSlot.reconfigure(codemirrorTheme()) });
    const watch = new MutationObserver(reflect);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const cache = states.current;
    return () => {
      watch.disconnect();
      created.destroy();
      view.current = null;
      cache.clear();
      current.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (current.current !== null) states.current.set(current.current, { state: v.state, revision: states.current.get(current.current)?.revision ?? 0 });
    current.current = path;
    const known = states.current.get(path);
    const fresh = () =>
      EditorState.create({
        doc: initialRef.current,
        extensions: [
          Prec.high(
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  hooks.current.onSave();
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
          languageFor(path),
          codeHighlight,
          keymap.of([...searchKeymap, ...foldKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.contentAttributes.of({ "aria-label": `Code of ${path}`, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) hooks.current.onChange(update.state.doc.toString());
          }),
          themeSlot.of(codemirrorTheme()),
        ],
      });
    if (known && known.revision === revision) {
      v.setState(known.state);
    } else {
      v.setState(fresh());
      states.current.set(path, { state: v.state, revision });
    }
    v.dispatch({ effects: themeSlot.reconfigure(codemirrorTheme()) });
  }, [path, revision]);

  return <div ref={host} className="kasten-author-editor" data-testid="smart-code-editor" />;
}
