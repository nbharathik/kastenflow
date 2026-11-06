import type { GeneratorOutput } from "@kasten-slides/wasm";
import { type JSX, useRef, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { CodeEditor } from "./CodeEditor.tsx";
import { InputsEditor } from "./InputsEditor.tsx";
import { libraryText, newId } from "./library-file.ts";
import { findCodePicture } from "./model.ts";
import { type RunReport, insertCodePicture, runPicture } from "./run.ts";
import { type Target, targetOf } from "./target.ts";
import { TemplateChooser } from "./TemplateChooser.tsx";
import type { CodeError, Program } from "./types.ts";
import "./code-picture.css";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The program a picture holds now, when it still has one. */
function programAt(props: Pick<DialogProps, "session">, target: Target): Program | null {
  if (target.kind !== "edit") return null;
  const found = findCodePicture(props.session.deck, target.slideId, target.id);
  return found ? { language: found.language, code: found.code, inputs: found.inputs, output: found.output } : null;
}

/**
 * The code panel. For a new picture it begins with the starting points; for one on the slide it edits the program kept inside the
 * picture. Run draws the picture again and swaps it in (one step of undo, the old picture stays in the store); a failure shows the
 * line it came from. Nothing runs here: the host runs the code where it is safe to.
 */
export function CodePictureDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const target = useRef(targetOf(ui)).current;
  const [program, setProgram] = useState<Program | null>(() => programAt({ session }, target));
  const [name, setName] = useState("My code picture");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CodeError | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [needsAllow, setNeedsAllow] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const { host } = session;
  const missing = target.kind === "edit" && program === null;

  const show = (report: RunReport) => {
    if (report.status === "done") {
      setShown(report.path);
      setNotes([...report.warnings.map((warning) => `Warning: ${warning}`), ...report.logs]);
      setNeedsAllow(false);
    } else if (report.status === "error") {
      setError(report.error);
    } else if (report.status === "needs-allow") {
      setNeedsAllow(true);
    } else {
      setError({ message: report.why });
    }
  };

  const run = async () => {
    if (!program || busy) return;
    setBusy(true);
    setError(null);
    setNotes([]);
    setSaid(null);
    try {
      if (target.kind === "edit") {
        show(await runPicture(session, target.slideId, target.id, program));
      } else {
        const made = await insertCodePicture(session, program, "A picture drawn by code");
        if ("error" in made) setError(made.error);
        else onClose();
      }
    } catch (err) {
      setError({ message: message(err) });
    } finally {
      setBusy(false);
    }
  };

  const allow = async () => {
    try {
      if (program) await host.generatorTrust?.allow(program.code);
      setNeedsAllow(false);
      await run();
    } catch (err) {
      setError({ message: message(err) });
    }
  };

  const save = async () => {
    if (!program || !host.generatorLibrary) return;
    try {
      const saved = await host.generatorLibrary.save(libraryText(newId(), name || "My code picture", program));
      setSaid(saved.replaced ? "Updated in your library." : `Saved to your library as “${name.trim() || "My code picture"}”.`);
    } catch (err) {
      setError({ message: message(err) });
    }
  };

  const change = (patch: Partial<Program>) => program && setProgram({ ...program, ...patch });
  const title = target.kind === "edit" ? "Edit code" : "Code picture";
  const word = target.kind === "edit" ? "Run" : "Add to slide";

  const footer = (
    <>
      {program && host.generatorLibrary ? (
        <>
          <input className="ks-cp-name" aria-label="Name in the library" value={name} onChange={(event) => setName(event.target.value)} />
          <TextButton onClick={() => void save()}>Save to library</TextButton>
        </>
      ) : null}
      <TextButton onClick={onClose}>{target.kind === "edit" ? "Done" : "Cancel"}</TextButton>
      {program ? (
        needsAllow ? (
          <TextButton primary disabled={busy} onClick={() => void allow()}>
            Allow to run
          </TextButton>
        ) : (
          <TextButton primary disabled={busy} onClick={() => void run()}>
            {busy ? "Running…" : word}
          </TextButton>
        )
      ) : null}
    </>
  );

  return (
    <Dialog title={title} width={680} side onClose={onClose} footer={footer}>
      {missing ? (
        <p className="ks-cp-error" role="alert">
          This picture has no code any more.
        </p>
      ) : program === null ? (
        <TemplateChooser
          host={host}
          onPick={(picked, label) => {
            setProgram(picked);
            setName(label);
          }}
          onError={(text) => setError({ message: text })}
        />
      ) : (
        <>
          <CodeEditor label="Code" value={program.code} errorLine={error?.line} onChange={(code) => change({ code })} onRun={() => void run()} />
          <InputsEditor inputs={program.inputs} onChange={(inputs) => change({ inputs })} />
          <div className="ks-cp-output" role="radiogroup" aria-label="Kind of picture">
            {(["svg", "png"] as GeneratorOutput[]).map((kind) => (
              <label key={kind}>
                <input type="radio" name="ks-cp-output" checked={program.output === kind} onChange={() => change({ output: kind })} />
                {kind === "svg" ? "SVG (sharp at any size)" : "PNG"}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="ks-cp-result" aria-live="polite">
        {needsAllow ? (
          <p className="ks-cp-allow" role="alert">
            An agent wrote this code. It runs in a sandbox with no network and no access to your vault; press Allow to run to let this deck's code run.
          </p>
        ) : null}
        {error ? (
          <p className="ks-cp-error" role="alert">
            {error.line ? `Line ${error.line}: ` : ""}
            {error.message}
          </p>
        ) : null}
        {notes.length > 0 ? (
          <ul className="ks-cp-notes" aria-label="What the code said">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        ) : null}
        {shown ? (
          <>
            <p className="ks-cp-ok">The picture on the slide is drawn again.</p>
            {host.imageUrl(shown) ? <img className="ks-cp-preview" src={host.imageUrl(shown)} alt="The picture the code drew" /> : null}
          </>
        ) : null}
        {said ? <p className="ks-cp-ok">{said}</p> : null}
      </div>
    </Dialog>
  );
}
