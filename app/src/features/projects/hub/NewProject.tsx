// "New project": a name, and what to start from (nothing, or a setup of a few
// pages, a whiteboard and sometimes a deck). What it would make is worked out
// by the core and shown before anything is written; Create then makes it in
// one step that Undo takes back.

import "./new-project.css";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { SetupInfo, SetupPlan } from "../../../lib/vault/project-types";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import { useWorkspace } from "../../workspace/store";
import { createProject } from "./create-project";
import { SavedChoice } from "./SavedChoice";
import { describePlan } from "./setup-preview";

/** What the preview is showing for the choice and the name. */
type Preview = { kind: "blank" } | { kind: "working" } | { kind: "plan"; id: string; plan: SetupPlan } | { kind: "error"; message: string };

const BLANK = { id: "blank", icon: "📄", name: "Blank", summary: "Just the project page." } as const;
/** How long the name rests before the preview asks the core again. */
const SETTLE_MS = 150;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function NewProject({ onClose }: { onClose: () => void }) {
  const client = useWorkspace((s) => s.client);
  const title = useId();
  const [name, setName] = useState("");
  const [setups, setSetups] = useState<SetupInfo[]>([]);
  const [chosen, setChosen] = useState<string>(BLANK.id);
  const [preview, setPreview] = useState<Preview>({ kind: "blank" });
  const [busy, setBusy] = useState(false);
  const ask = useRef(0);

  // A client that cannot list setups still offers a blank project.
  const reload = useCallback(
    (live: () => boolean = () => true) =>
      Promise.resolve()
        .then(() => client?.listSetups())
        .then(
          (list) => {
            if (!live()) return;
            setSetups(list ?? []);
            // A setup that is gone (deleted here) is no longer the choice.
            setChosen((was) => (was === BLANK.id || list?.some((s) => s.id === was) ? was : BLANK.id));
          },
          () => {},
        ),
    [client],
  );
  useEffect(() => {
    let live = true;
    void reload(() => live);
    return () => {
      live = false;
    };
  }, [reload]);

  const setup = setups.find((s) => s.id === chosen);
  const words = name.trim();
  useEffect(() => {
    const mine = ++ask.current;
    if (!setup || !client) {
      setPreview({ kind: "blank" });
      return;
    }
    // What is shown stays while the core is asked again, so typing does not make it flicker.
    setPreview((was) => (was.kind === "plan" && was.id === setup.id ? was : { kind: "working" }));
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => client.previewSetup(setup.id, { kind: "new", title: words || "New project" }))
        .then(
          (plan) => mine === ask.current && setPreview({ kind: "plan", id: setup.id, plan }),
          (err: unknown) => mine === ask.current && setPreview({ kind: "error", message: message(err) }),
        );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [client, setup, words]);

  const ready = words !== "" && !busy && preview.kind !== "error";
  const create = async () => {
    if (!ready) return;
    setBusy(true);
    const made = await createProject(setup ?? "blank", words);
    setBusy(false);
    if (made) onClose();
  };

  const builtIn = setups.filter((s) => !s.saved);
  const mine = setups.filter((s) => s.saved);
  // The arrow keys go through all of them, the blank one first and "Your setups" last.
  const choices: { id: string; icon: string; name: string; summary: string }[] = [BLANK, ...builtIn, ...mine];
  const onRadioKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    // The event is reused once it has been handled: keep the group itself.
    const group = event.currentTarget;
    const next = choices[(choices.findIndex((c) => c.id === chosen) + step + choices.length) % choices.length]!;
    setChosen(next.id);
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-choice="${next.id}"]`)?.focus());
  };

  return (
    <Modal labelledBy={title} onClose={onClose} className="ui-dialog kasten-hub-new">
      <form
        className="kasten-hub-new-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2 id={title} className="kasten-hub-new-title">
          New project
        </h2>
        <label className="kasten-hub-new-field">
          <span>Name</span>
          <input autoFocus className="ui-field" aria-label="Project name" placeholder="What is the project called?" value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} autoComplete="off" />
        </label>

        <div className="kasten-hub-new-field">
          <span id={`${title}-start`}>Start from</span>
          <div role="radiogroup" aria-labelledby={`${title}-start`} className="kasten-hub-choices" onKeyDown={onRadioKey}>
            <div role="presentation" className="kasten-hub-setups">
              {[BLANK, ...builtIn].map((choice) => (
                <button key={choice.id} type="button" role="radio" aria-checked={choice.id === chosen} data-choice={choice.id} tabIndex={choice.id === chosen ? 0 : -1} className="kasten-hub-setup" onClick={() => setChosen(choice.id)}>
                  <span className="kasten-hub-setup-icon" aria-hidden="true">
                    {choice.icon}
                  </span>
                  <span className="kasten-hub-setup-name">{choice.name}</span>
                  <span className="kasten-hub-setup-summary">{choice.summary}</span>
                </button>
              ))}
            </div>
            {mine.length > 0 && (
              <>
                <p role="presentation" className="kasten-hub-mine-heading">
                  Your setups
                </p>
                <div role="presentation" className="kasten-hub-setups">
                  {mine.map((item) => (
                    <SavedChoice key={item.id} setup={item} chosen={item.id === chosen} onChoose={() => setChosen(item.id)} onChanged={() => void reload()} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <section className="kasten-hub-plan" aria-label="What it makes" aria-live="polite">
          <PlanView preview={preview} />
        </section>

        <div className="ui-dialog-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={!ready}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PlanView({ preview }: { preview: Preview }) {
  if (preview.kind === "blank") return <p>It makes the project page and nothing else.</p>;
  if (preview.kind === "working") return <p className="is-quiet">Working out what it makes…</p>;
  if (preview.kind === "error") return <p className="is-error">{preview.message}</p>;
  const text = describePlan(preview.plan);
  const lists: [string, string[]][] = [
    ["Pages", text.pages],
    ["Whiteboards", text.boards],
    ["Decks", text.decks],
    ["Tag databases", text.databases],
  ];
  return (
    <>
      <p>It makes: {text.sentence}</p>
      <dl>
        {lists
          .filter(([, names]) => names.length > 0)
          .map(([heading, names]) => (
            <div key={heading}>
              <dt>{heading}</dt>
              <dd>{names.join(", ")}</dd>
            </div>
          ))}
      </dl>
      {text.kept > 0 && <p className="is-quiet">{text.kept === 1 ? "1 file is there already and stays" : `${text.kept} files are there already and stay`} as {text.kept === 1 ? "it is" : "they are"}.</p>}
    </>
  );
}
