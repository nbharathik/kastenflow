import { useRef } from "react";

import { Button, IconButton } from "../../../../ui/Button";
import { type Row, blocksBefore, evidenceFromText, nameOf } from "./model";

/** The layouts a slide of the storyboard can be asked for; the others of a theme are for the editor. */
export const LAYOUTS: readonly { value: string; label: string }[] = [
  { value: "", label: "Automatic" },
  { value: "title-body", label: "Title and body" },
  { value: "title-only", label: "Title only" },
  { value: "section", label: "Section" },
];

const FIELD = "w-full rounded-lg border border-line bg-canvas px-2.5 text-13 text-ink outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15";

interface RowEditorProps {
  row: Row;
  index: number;
  count: number;
  /** The evidence as the person has it in the box (not yet read back into blocks while they type). */
  text: string;
  onTitle(value: string): void;
  onPoint(value: string): void;
  onNotes(value: string): void;
  onLayout(value: string): void;
  onText(value: string, blocks: string[]): void;
  onMove(by: -1 | 1): void;
  onMerge(): void;
  /** Cuts the evidence after `at` blocks. */
  onSplit(at: number): void;
  onLeaveOut(out: boolean): void;
}

/** One slide of the storyboard: its title, its point, its evidence and notes, and what can be done with it as a whole. */
export function RowEditor({ row, index, count, text, onTitle, onPoint, onNotes, onLayout, onText, onMove, onMerge, onSplit, onLeaveOut }: RowEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const { entry, leftOut } = row;
  const name = nameOf(entry, index);
  const from = entry.sources.map((source) => (source.section ? `${source.title ?? source.page} › ${source.section}` : (source.title ?? source.page))).join(" + ");
  return (
    <li className={`rounded-xl border border-line p-3 ${leftOut ? "opacity-60" : ""}`} aria-label={`Slide ${index + 1}: ${name}`}>
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-center text-13 text-muted" aria-hidden="true">
          {index + 1}
        </span>
        <input aria-label={`Title of slide ${index + 1}`} value={entry.title} onChange={(event) => onTitle(event.target.value)} className={`h-9 flex-1 font-medium ${FIELD}`} />
        <IconButton icon="chevron-up" label={`Move up: ${name}`} size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="chevron-down" label={`Move down: ${name}`} size="sm" disabled={index === count - 1} onClick={() => onMove(1)} />
        <IconButton icon={leftOut ? "eye" : "eye-off"} label={leftOut ? `Put back: ${name}` : `Leave out: ${name}`} size="sm" active={leftOut} onClick={() => onLeaveOut(!leftOut)} />
      </div>
      {leftOut ? (
        <p className="mt-2 pl-8 text-12 text-muted">Left out: no slide is made of this one.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 pl-8">
          <label className="flex flex-col gap-1 text-12 text-muted">
            Point (the sentence the slide makes)
            <input aria-label={`Point of slide ${index + 1}`} value={entry.point ?? ""} onChange={(event) => onPoint(event.target.value)} className={`h-8 ${FIELD}`} />
          </label>
          <label className="flex flex-col gap-1 text-12 text-muted">
            Evidence (list items, pictures, tables, code)
            <textarea
              ref={area}
              aria-label={`Evidence of slide ${index + 1}`}
              value={text}
              rows={Math.min(8, Math.max(3, text.split("\n").length))}
              spellCheck={false}
              onChange={(event) => onText(event.target.value, evidenceFromText(event.target.value))}
              className={`py-1.5 font-mono ${FIELD}`}
            />
          </label>
          <details>
            <summary className="cursor-pointer text-12 text-muted">Notes for the speaker</summary>
            <textarea aria-label={`Notes of slide ${index + 1}`} value={entry.notes ?? ""} rows={3} onChange={(event) => onNotes(event.target.value)} className={`mt-1 py-1.5 ${FIELD}`} />
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-12 text-muted">
              Layout
              <select aria-label={`Layout of slide ${index + 1}`} value={entry.layout ?? ""} onChange={(event) => onLayout(event.target.value)} className="h-8 rounded-lg border border-line bg-canvas px-2 text-13 text-ink">
                {LAYOUTS.map((layout) => (
                  <option key={layout.value} value={layout.value}>
                    {layout.label}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" disabled={index === count - 1} onClick={onMerge} aria-label={`Merge ${name} with the next slide`}>
              Merge with next
            </Button>
            <Button size="sm" onClick={() => onSplit(blocksBefore(text, area.current?.selectionStart ?? text.length))} aria-label={`Split ${name} at the cursor`} title="Put the cursor between two items of the evidence: the rest becomes a slide of its own">
              Split at the cursor
            </Button>
            <span className="min-w-0 flex-1 truncate text-right text-12 text-muted">{from ? `From ${from}` : "Not from the page"}</span>
          </div>
        </div>
      )}
    </li>
  );
}
