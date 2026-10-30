// The formula field of a property in the schema editor: a text box, a
// "Functions" list to pick from (name, one line, example) and under it the
// core's verdict on what is typed.

import { useId, useRef, useState } from "react";

import type { FormulaIssue } from "../../../lib/vault/types";
import { Popup } from "../../pages/page/Popup";
import "./formula.css";
import { FORMULA_FUNCTIONS } from "./functions";
import { issueText } from "./use-formula-checks";

interface FormulaFieldProps {
  /** The property's name, for the field's label. */
  name: string;
  value: string;
  issue: FormulaIssue | null;
  onChange(next: string): void;
}

export function FormulaField({ name, value, issue, onChange }: FormulaFieldProps) {
  const [listing, setListing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const note = useId();
  const label = name || "the new property";
  const pick = (example: string) => {
    onChange(value.trim() === "" ? example : `${value}${example}`);
    setListing(false);
    field.current?.focus();
  };
  return (
    <div className="kasten-formula-field">
      <div className="kasten-formula-input">
        <input
          ref={field}
          aria-label={`Formula of ${label}`}
          aria-invalid={issue !== null}
          aria-describedby={note}
          placeholder="days_until(deadline)"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="relative">
          <button ref={button} type="button" className="kasten-tagdb-button" aria-haspopup="dialog" aria-expanded={listing} onClick={() => setListing(!listing)}>
            Functions
          </button>
          {listing && (
            <Popup label="Formula functions" anchor={button} onClose={() => setListing(false)} className="kasten-tagdb-popup">
              <div className="kasten-formula-help">
                {FORMULA_FUNCTIONS.map((fn) => (
                  <button key={fn.name} type="button" onClick={() => pick(fn.example)}>
                    <b>{fn.name}</b>
                    <span>{fn.help}</span>
                    <code>{fn.example}</code>
                  </button>
                ))}
              </div>
            </Popup>
          )}
        </span>
      </div>
      <p id={note} role={issue ? "alert" : undefined} className={issue ? "kasten-formula-issue" : "kasten-formula-ok"}>
        {issue ? issueText(issue) : "Calculated for every note when it is shown; it is never written into a note."}
      </p>
    </div>
  );
}
