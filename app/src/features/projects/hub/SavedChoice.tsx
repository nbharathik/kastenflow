// One of "Your setups" in the New project dialog: a choice like the built-in
// ones, with a rename and a delete beside it. Rename is in place (Enter keeps
// it, Escape leaves it); delete moves the setup to the trash and a notice
// offers Undo. The arrow keys that move between choices stay out of the name
// field.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { SetupInfo } from "../../../lib/vault/project-types";
import { IconButton } from "../../../ui/Button";
import { renameSavedSetup, trashSavedSetup } from "../setups/setup-actions";

interface Props {
  setup: SetupInfo;
  chosen: boolean;
  onChoose(): void;
  /** The list of setups changed: read it again. */
  onChanged(): void;
}

export function SavedChoice({ setup, chosen, onChoose, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(setup.name);
  const field = useRef<HTMLInputElement>(null);
  /** Enter, Escape and leaving the field each end the editing once. */
  const ended = useRef(false);
  useEffect(() => {
    if (editing) {
      ended.current = false;
      field.current?.focus();
      field.current?.select();
    }
  }, [editing]);

  const keep = async () => {
    if (ended.current) return;
    ended.current = true;
    const next = name.trim();
    setEditing(false);
    if (next === "" || next === setup.name) return setName(setup.name);
    if (await renameSavedSetup(setup, next)) onChanged();
    else setName(setup.name);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // The choices' arrow keys, the form's Enter and the dialog's Escape are not for this field.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void keep();
    } else if (event.key === "Escape") {
      event.preventDefault();
      ended.current = true;
      setName(setup.name);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="kasten-hub-mine">
        <div className="kasten-hub-setup is-editing">
          <span className="kasten-hub-setup-icon" aria-hidden="true">
            {setup.icon}
          </span>
          <input ref={field} className="ui-field kasten-hub-setup-field" aria-label={`New name for the setup “${setup.name}”`} value={name} spellCheck={false} autoComplete="off" onChange={(event) => setName(event.target.value)} onKeyDown={onKey} onBlur={() => void keep()} />
          <span className="kasten-hub-setup-summary">Enter keeps the name, Escape leaves it.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="kasten-hub-mine">
      <button type="button" role="radio" aria-checked={chosen} data-choice={setup.id} tabIndex={chosen ? 0 : -1} className="kasten-hub-setup" onClick={onChoose}>
        <span className="kasten-hub-setup-icon" aria-hidden="true">
          {setup.icon}
        </span>
        <span className="kasten-hub-setup-name">{setup.name}</span>
        <span className="kasten-hub-setup-summary">{setup.summary}</span>
      </button>
      <div className="kasten-hub-mine-actions">
        <IconButton icon="edit" size="sm" label={`Rename the setup “${setup.name}”`} onClick={() => setEditing(true)} />
        <IconButton icon="trash" size="sm" label={`Delete the setup “${setup.name}”`} onClick={() => void trashSavedSetup(setup, onChanged).then((went) => went && onChanged())} />
      </div>
    </div>
  );
}
