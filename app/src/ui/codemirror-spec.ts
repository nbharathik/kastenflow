// The look of a CodeMirror editor, written with the app's colour tokens. The
// tokens change with the theme, so one spec reads in light and dark and
// needs no rebuilding when `data-theme` flips.

export type ThemeSpec = Record<string, Record<string, string>>;

export function codeThemeSpec(): ThemeSpec {
  return {
    "&": { color: "var(--color-ink)", backgroundColor: "var(--color-panel)" },
    ".cm-content": { caretColor: "var(--color-ink)", fontFamily: "var(--font-mono, ui-monospace, monospace)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
    "&.cm-focused": { outline: "none" },
    ".cm-activeLine": { backgroundColor: "var(--color-hover)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--color-selected)",
    },
    ".cm-selectionBackground": { backgroundColor: "var(--color-selected)" },
    ".cm-gutters": { backgroundColor: "var(--color-panel)", color: "var(--color-faint)", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "var(--color-hover)", color: "var(--color-ink)" },
    ".cm-panels": { backgroundColor: "var(--color-raised)", color: "var(--color-ink)" },
    ".cm-tooltip": { backgroundColor: "var(--color-raised)", color: "var(--color-ink)", border: "1px solid var(--color-line)" },
    ".cm-matchingBracket": { backgroundColor: "var(--color-soft)", outline: "1px solid var(--color-line-strong)" },
    // The canvas token is the editor's page when it sits on a card.
    ".cm-scroller": { backgroundColor: "var(--color-canvas)" },
  };
}
