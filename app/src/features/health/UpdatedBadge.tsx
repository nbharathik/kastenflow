// "Updated" on a board, deck or diagram shown in a page: the item changed after
// the page showed it (elsewhere, by an agent, or in another window). The
// embed shows the new version already; the badge only says so, and a click puts
// it away until the next change. It sits in the corner of the embed's body.

import "./health.css";

import { useBoards } from "../boards/store";
import { useDiagrams } from "../diagrams/store";
import { useDecks } from "../slides/store";
import { useUpdated } from "./use-updated";

type Kind = "board" | "deck" | "diagram";

/** What the badge needs of each kind: its list and its counter (a diagram counts with decks). */
function useItem(kind: Kind, path: string): { title: string; modified: number | undefined; area: "boards" | "decks" } {
  const board = useBoards((s) => (kind === "board" ? s.list.find((b) => b.path === path) : undefined));
  const deck = useDecks((s) => (kind === "deck" ? s.list.find((d) => d.path === path) : undefined));
  const diagram = useDiagrams((s) => (kind === "diagram" ? s.list.find((d) => d.path === path) : undefined));
  const item = board ?? deck ?? diagram;
  return { title: item?.title ?? path.replace(/^.*\//, ""), modified: item?.modified, area: kind === "board" ? "boards" : "decks" };
}

export function UpdatedBadge({ kind, path }: { kind: Kind; path: string }) {
  const { title, modified, area } = useItem(kind, path);
  const { updated, dismiss } = useUpdated(area, modified);
  if (!updated) return null;
  return (
    <button type="button" className="kasten-updated" aria-label={`${title} was updated. Dismiss`} title={`${title} changed since you opened this page. What you see is the new version. Click to dismiss.`} onClick={dismiss}>
      Updated
    </button>
  );
}
