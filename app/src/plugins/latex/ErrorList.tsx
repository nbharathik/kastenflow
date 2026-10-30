// What the last build said, as a list under the editor: errors first, then
// warnings and notes, each with its file and line. A click, or Enter, opens the
// file and puts the caret on the line. Nothing is shown when the build had
// nothing to say.

import { useState } from "react";

import { Button, IconButton } from "../../ui/Button";
import { fixAction } from "./fixable";
import { arrowFocus } from "./list-keys";
import type { DocFile, Diagnostic, Severity } from "./types";

interface Props {
  diagnostics: readonly Diagnostic[];
  folder: string;
  /** The root file, relative: where a message with no file belongs. */
  main: string;
  files: readonly DocFile[];
  onJump(path: string, line: number): void;
  /** Asks the chat to fix what the build complained about; offered while there is something it can fix (errors, undefined references, boxes). */
  onFix?(): void;
  /** "Fix this one" and "Explain" for a single problem; each row offers them when given. */
  onFixOne?(problem: Diagnostic): void;
  onExplain?(problem: Diagnostic): void;
  /** A sentence about the engine (the document needs XeLaTeX), shown above the list. */
  advice?: string | null;
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const WORD: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };

/** "2 errors, 1 warning". */
export function summary(diagnostics: readonly Diagnostic[]): string {
  const count = (s: Severity) => diagnostics.filter((d) => d.severity === s).length;
  const parts = [
    [count("error"), "error"],
    [count("warning"), "warning"],
    [count("info"), "note"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`)
    .join(", ");
}

export function ErrorList({ diagnostics, folder, main, files, onJump, onFix, onFixOne, onExplain, advice }: Props) {
  const [open, setOpen] = useState(true);
  if (diagnostics.length === 0) return null;
  const rows = diagnostics
    .map((d, at) => ({ d, at }))
    .sort((a, b) => ORDER[a.d.severity] - ORDER[b.d.severity] || a.at - b.at)
    .map(({ d, at }) => {
      const file = d.file ?? main;
      const path = `${folder}/${file}`;
      return { d, at, file, path, canOpen: files.some((f) => f.path === path && f.editable) };
    });
  const hasError = diagnostics.some((d) => d.severity === "error");
  const fixable = fixAction(diagnostics) !== null;
  return (
    <section className="latex-problems" aria-label="Problems from the last build">
      <div className="latex-problems-bar">
        <span className={hasError ? "is-error" : undefined} aria-live="polite">
          {summary(diagnostics)}
        </span>
        <span className="latex-spacer" />
        {fixable && onFix && (
          <Button size="sm" tone="quiet" icon="wand" onClick={onFix} title="Ask the assistant to fix these problems; you look at what it changes first, and its answer may be wrong">
            Fix with AI
          </Button>
        )}
        <IconButton size="sm" icon={open ? "chevron-down" : "chevron-up"} label={open ? "Hide the problems" : "Show the problems"} aria-expanded={open} onClick={() => setOpen(!open)} />
      </div>
      {open && advice && (
        <p className="latex-problems-advice" role="note">
          {advice}
        </p>
      )}
      {open && (
        <ul className="latex-problems-list" onKeyDown={arrowFocus}>
          {rows.map(({ d, at, file, path, canOpen }) => (
            <li key={at} className="latex-problem-row">
              {canOpen ? (
                <button type="button" className={`latex-problem is-${d.severity}`} onClick={() => onJump(path, d.line ?? 1)}>
                  <Row d={d} file={file} />
                </button>
              ) : (
                <div className={`latex-problem is-${d.severity}`}>
                  <Row d={d} file={file} />
                </div>
              )}
              {(onFixOne || onExplain) && (
                <span className="latex-problem-ask">
                  {onFixOne && <IconButton size="sm" icon="wand" label={`Fix this one, ${placeOf(d, file)}`} title="Ask the assistant to fix this one; its answer may be wrong" data-aside="" onClick={() => onFixOne(d)} />}
                  {onExplain && <IconButton size="sm" icon="bulb" label={`Explain, ${placeOf(d, file)}`} title="Ask the assistant to explain this one; its answer may be wrong" data-aside="" onClick={() => onExplain(d)} />}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const placeOf = (d: Diagnostic, file: string): string => (d.line === null ? file : `${file}:${d.line}`);

function Row({ d, file }: { d: Diagnostic; file: string }) {
  return (
    <>
      <span className="latex-problem-kind">{WORD[d.severity]}</span>
      <span className="latex-problem-place">{d.line === null ? file : `${file}:${d.line}`}</span>
      <span className="latex-problem-text">{d.message}</span>
    </>
  );
}
