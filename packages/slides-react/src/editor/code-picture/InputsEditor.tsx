import type { GeneratorInput, GeneratorInputKind } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { TextButton } from "../ui/Button.tsx";
import { MOST_INPUTS } from "./model.ts";
import "./code-picture.css";

const KINDS: { value: GeneratorInputKind; label: string; hint: string }[] = [
  { value: "data", label: "Text", hint: "The text itself, such as a few rows of a CSV" },
  { value: "asset", label: "File", hint: "A CSV or other text file in the images store, by its path" },
  { value: "note", label: "Page", hint: "A page of the vault, by its path" },
];

export interface InputsEditorProps {
  inputs: GeneratorInput[];
  onChange(inputs: GeneratorInput[]): void;
}

/** The names the code reads: `inputs.<name>` is the text of each. They are read-only for the code. */
export function InputsEditor({ inputs, onChange }: InputsEditorProps): JSX.Element {
  const change = (at: number, patch: Partial<GeneratorInput>) => onChange(inputs.map((input, i) => (i === at ? { ...input, ...patch } : input)));
  const free = (): string => {
    for (let n = inputs.length + 1; ; n++) if (!inputs.some((input) => input.name === `data${n}`)) return `data${n}`;
  };
  return (
    <fieldset className="ks-cp-inputs">
      <legend>What the code may read (inputs.name)</legend>
      {inputs.map((input, i) => (
        <div className="ks-cp-input" key={i}>
          <input aria-label={`Name of input ${i + 1}`} value={input.name} spellCheck={false} onChange={(event) => change(i, { name: event.target.value })} />
          <select aria-label={`Where input ${i + 1} comes from`} value={input.kind} onChange={(event) => change(i, { kind: event.target.value as GeneratorInputKind })}>
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value} title={kind.hint}>
                {kind.label}
              </option>
            ))}
          </select>
          {input.kind === "data" ? (
            <textarea aria-label={`Text of input ${i + 1}`} value={input.value} spellCheck={false} onChange={(event) => change(i, { value: event.target.value })} />
          ) : (
            <input aria-label={`Path of input ${i + 1}`} value={input.value} spellCheck={false} placeholder={input.kind === "asset" ? "assets/sales.csv" : "library/notes.md"} onChange={(event) => change(i, { value: event.target.value })} />
          )}
          <TextButton aria-label={`Remove input ${i + 1}`} onClick={() => onChange(inputs.filter((_, at) => at !== i))}>
            Remove
          </TextButton>
        </div>
      ))}
      <div>
        <TextButton disabled={inputs.length >= MOST_INPUTS} onClick={() => onChange([...inputs, { name: free(), kind: "data", value: "" }])}>
          Add input
        </TextButton>
      </div>
    </fieldset>
  );
}
