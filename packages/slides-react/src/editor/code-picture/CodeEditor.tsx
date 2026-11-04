import { type JSX, type KeyboardEvent, useRef } from "react";

import "./code-picture.css";

export interface CodeEditorProps {
  value: string;
  onChange(code: string): void;
  /** The line (from 1) an error points at; it is marked in the margin. */
  errorLine?: number | undefined;
  /** Ctrl+Enter (Cmd+Enter on a Mac) in the code runs it. */
  onRun?(): void;
  label: string;
}

/**
 * A plain text area for code, in a monospace face, with the line numbers beside it. It is a text area on purpose: it is a native
 * field, so the keyboard, selection, undo and a screen reader work as they do everywhere, and Tab leaves it as it leaves any field.
 */
export function CodeEditor({ value, onChange, errorLine, onRun, label }: CodeEditorProps): JSX.Element {
  const margin = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onRun) {
      event.preventDefault();
      onRun();
    }
  };
  return (
    <div className="ks-cp-editor">
      <div ref={margin} className="ks-cp-margin" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={i + 1 === errorLine ? "is-error" : undefined} data-line={i + 1}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        className="ks-cp-code"
        aria-label={label}
        aria-describedby="ks-cp-hint"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        data-autofocus=""
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (margin.current) margin.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
      <span id="ks-cp-hint" className="ks-cp-hint">
        Ctrl+Enter runs the code.
      </span>
    </div>
  );
}
