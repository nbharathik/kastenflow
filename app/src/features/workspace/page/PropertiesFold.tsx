// The disclosure at the top left of a page's properties: "▾ Properties" when
// they show, one quiet line "▸ 7 properties · #paper #idea" when folded.

import { useEffect } from "react";

import type { NoteMeta } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { tagPlace } from "../../tags/place";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { foldKey, isFolded, propertyCount, setFoldChoice } from "./properties-fold";

/** Whether `note`'s properties are folded now. Adding a property unfolds them first. */
export function useFolded(note: NoteMeta, adding: boolean): boolean {
  const mode = usePrefs((s) => s.propsFold);
  const choice = usePrefs((s) => s.propsFolded[foldKey(note)]);
  const folded = isFolded(mode, choice, propertyCount(note));
  useEffect(() => {
    if (adding && folded) setFoldChoice(note, false);
  }, [adding, folded, note]);
  return folded && !adding;
}

interface FoldBarProps {
  note: NoteMeta;
  folded: boolean;
}

export function FoldBar({ note, folded }: FoldBarProps) {
  const count = propertyCount(note);
  const summary = count === 0 ? "No properties" : `${count} ${count === 1 ? "property" : "properties"}`;
  return (
    <div className={`kasten-props-fold${folded ? " is-folded" : ""}`}>
      <button
        type="button"
        className="kasten-props-fold-toggle"
        aria-expanded={!folded}
        aria-label={folded ? "Unfold properties" : "Fold properties"}
        title={folded ? "Unfold properties" : "Fold properties"}
        onClick={() => setFoldChoice(note, !folded)}
      >
        <Icon name="chevron" className="kasten-props-fold-chevron size-3.5" />
        <span>{folded ? summary : "Properties"}</span>
      </button>
      {folded &&
        note.tags.map((tag, i) => (
          <button key={tag} type="button" className="kasten-props-fold-tag" title={`Open #${tag}`} onClick={() => useWorkspace.getState().go(tagPlace(tag))}>
            {i === 0 && <span aria-hidden="true">· </span>}#{tag}
          </button>
        ))}
    </div>
  );
}
