// Home's Favourites: the notes you starred, as a thin row above the list.
// Nothing is drawn until there is one. While the vault is read, a row with
// starred notes keeps its place, so the list does not drop when they arrive.

import { useMemo } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { iconOf, titleOf } from "../workspace/names";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { noteAt } from "../workspace/tree";
import { ChipRow, type Chip } from "./ChipRow";

export function Favourites() {
  const favourites = usePrefs((s) => s.favourites);
  const notes = useWorkspace((s) => s.notes);
  const waiting = useWorkspace((s) => !s.ready && s.notes.length === 0);
  const chips = useMemo<Chip[]>(
    () =>
      favourites
        .map((path) => noteAt(notes, path))
        .filter((note): note is NoteMeta => Boolean(note))
        .map((note) => ({ path: note.path, label: titleOf(note), icon: <IconOrEmoji icon={iconOf(note)} />, open: (how) => useWorkspace.getState().openPath(note.path, how) })),
    [favourites, notes],
  );
  if (waiting && favourites.length > 0) {
    return (
      <div className="kasten-home-chips" aria-hidden="true">
        <span className="kasten-home-bone is-chip" />
        <span className="kasten-home-bone is-chip" />
      </div>
    );
  }
  if (chips.length === 0) return null;
  return <ChipRow label="Favourites" icon="star" chips={chips} />;
}
