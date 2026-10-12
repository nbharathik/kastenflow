// Settings → Pages: where links and sub-pages open, and what "to the right" does.

import { isOpens, OPENS, OPENS_LABEL } from "../../opens";
import { usePrefs } from "../../prefs";
import { Row, resetOf, Segmented } from "./parts";

const RIGHT = [
  { id: "replace", label: "Replaces the tab" },
  { id: "add", label: "Adds a tab" },
] as const;

/** Rows for the Pages group. */
export function OpeningRows() {
  const prefs = usePrefs();
  return (
    <>
      <Row id="pages.links" {...resetOf(prefs.pageLinksOpen, "here", (pageLinksOpen) => prefs.set({ pageLinksOpen }))}>
        <select
          aria-label="Open links and sub-pages in"
          value={prefs.pageLinksOpen}
          onChange={(event) => isOpens(event.target.value) && prefs.set({ pageLinksOpen: event.target.value })}
          className="ui-field kasten-set-select"
        >
          {OPENS.map((value) => (
            <option key={value} value={value}>
              {OPENS_LABEL[value]}
            </option>
          ))}
        </select>
      </Row>
      <Row id="pages.right" {...resetOf(prefs.rightReplaces, true, (rightReplaces) => prefs.set({ rightReplaces }))}>
        <Segmented label="Open to the right" value={prefs.rightReplaces ? "replace" : "add"} options={[...RIGHT]} onChange={(value) => prefs.set({ rightReplaces: value === "replace" })} />
      </Row>
    </>
  );
}
