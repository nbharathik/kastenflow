// What a rehearsal came to: the time on each slide beside the time on the same slide in the last run, and the choice to keep the run or
// let it go. It is also how a run in the list of past rehearsals is read (`readOnly`).

import type { Deck } from "@kasten-slides/wasm";
import type { JSX } from "react";

import type { RehearsalRecord, RunComparison } from "./rehearsal.ts";
import { deltaText, durationText } from "./rehearsal-text.ts";
import "./rehearsal.css";

export interface RehearsalSummaryProps {
  deck: Pick<Deck, "slides">;
  record: RehearsalRecord;
  comparison: RunComparison;
  /** The run has been kept. */
  saved?: boolean;
  /** Why it could not be kept. */
  error?: string | null;
  /** Keeps the run, or discards it. Without them the summary only shows. */
  onSave?: () => void;
  onDiscard?: () => void;
  /** Drawn in the flow of a dialog of the editor, not over the presenter's view. */
  inline?: boolean;
}

export function RehearsalSummary({ deck, record, comparison, saved = false, error = null, onSave, onDiscard, inline = false }: RehearsalSummaryProps): JSX.Element {
  const numbers = new Map(deck.slides.map((slide, i) => [slide.id, i + 1]));
  const steps = new Map(record.slides.map((slide) => [slide.id, slide.steps]));
  const hasPrevious = comparison.rows.some((row) => row.previousMs !== undefined);
  return (
    <section className={`ks-pv-summary${inline ? " is-inline" : ""}`} role={inline ? "region" : "dialog"} aria-label="Rehearsal summary">
      <h2 className="ks-pv-heading">How the rehearsal went</h2>
      <p className="ks-pv-summary-total">
        Total <strong>{durationText(record.totalMs)}</strong>
        {record.targetMs !== undefined ? <> of {durationText(record.targetMs)} aimed for</> : null}
      </p>
      {comparison.rows.length === 0 ? (
        <p className="ks-pv-none">No slide was timed.</p>
      ) : (
        <table className="ks-pv-table">
          <thead>
            <tr>
              <th scope="col">Slide</th>
              <th scope="col">Time</th>
              <th scope="col">Last time</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => {
              const splits = (steps.get(row.id) ?? []).filter((split) => split.ms > 0);
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <span className="ks-pv-slide-name">
                      {numbers.get(row.id) ?? "·"}. {row.title}
                    </span>
                    {splits.length > 1 ? <span className="ks-pv-splits">Steps: {splits.map((split) => `${split.step} ${durationText(split.ms)}`).join(" · ")}</span> : null}
                  </th>
                  <td>{durationText(row.ms)}</td>
                  <td>{row.previousMs === undefined ? "–" : durationText(row.previousMs)}</td>
                  <td className={row.deltaMs === undefined ? "" : row.deltaMs > 0 ? "is-longer" : row.deltaMs < 0 ? "is-shorter" : ""}>{row.deltaMs === undefined ? "–" : deltaText(row.deltaMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!hasPrevious ? <p className="ks-pv-none">There is no earlier run to compare with.</p> : null}
      {comparison.outdated ? <p className="ks-pv-warning">The last run was of an earlier version of this deck, so only the slides they share are compared. It is marked outdated.</p> : null}
      {error ? (
        <p className="ks-pv-warning" role="alert">
          {error}
        </p>
      ) : null}
      {onSave || onDiscard ? (
        <div className="ks-pv-controls">
          {saved ? (
            <>
              <span role="status" className="ks-pv-saved">
                Saved
              </span>
              <button type="button" className="ks-pv-button" onClick={onDiscard}>
                Close
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ks-pv-button is-primary" onClick={onSave}>
                Save
              </button>
              <button type="button" className="ks-pv-button" onClick={onDiscard}>
                Discard
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
