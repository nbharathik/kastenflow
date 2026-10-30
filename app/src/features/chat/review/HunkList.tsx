// A text change drawn hunk by hunk, each with Keep and Undo. Keep is the
// agent's change; Undo leaves that part as the page has it. Nothing is
// written here: the choices go back to the card, which writes them as one
// change when the person applies them.

import { DiffStats, DiffView } from "../../review/DiffView";
import { count } from "../../review/words";
import type { Hunk } from "./hunks";

interface Props {
  hunks: readonly Hunk[];
  /** The hunks the person undid, by index. */
  undone: ReadonlySet<number>;
  disabled: boolean;
  label: string;
  onChoose(index: number, keep: boolean): void;
}

export function HunkList({ hunks, undone, disabled, label, onChoose }: Props) {
  return (
    <ol className="kc-hunks" aria-label={label}>
      {hunks.map((hunk) => {
        const out = undone.has(hunk.index);
        const name = `Change ${hunk.index + 1} of ${hunks.length}`;
        return (
          <li key={hunk.index} className="kc-hunk" data-undone={out || undefined}>
            <div className="kc-hunk-head">
              <span className="kc-hunk-name">
                {name}
                <span className="sr-only">{out ? ", undone" : ", kept"}</span>
              </span>
              <DiffStats lines={hunk.lines} />
              <span className="kc-hunk-choice" role="group" aria-label={name}>
                <button type="button" aria-pressed={!out} disabled={disabled} aria-label={`Keep ${name.toLowerCase()}`} onClick={() => onChoose(hunk.index, true)}>
                  Keep
                </button>
                <button type="button" aria-pressed={out} disabled={disabled} aria-label={`Undo ${name.toLowerCase()}`} onClick={() => onChoose(hunk.index, false)}>
                  Undo
                </button>
              </span>
            </div>
            <div className="kc-hunk-diff">
              <DiffView lines={hunk.lines} mode="unified" label={`${name}: ${count(hunk.added, "line")} added, ${count(hunk.removed, "line")} removed`} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
