// A `[[link]]` whose target is a file in the vault (`[[talk.deck]]`,
// `[[map.canvas]]`, `[[tags/paper.yaml]]`, `[[scan.pdf]]`) is not a page: it
// reads as the file's title, opens the file, and never offers to make a page
// of that name.

import {
  findBoard,
  findDatabase,
  findDeck,
  findDiagram,
  isBoardTarget,
  isDatabaseTarget,
  isDeckTarget,
  isDiagramTarget,
  isFileTarget,
  type LinkHow,
  type LinkProvider,
} from "../links";

export interface FileMention {
  /** What the mention reads, without the extension where the workspace knows a title. */
  title: string;
  icon: string;
  /** Whether the workspace has the file; a kind it cannot look up counts as found. */
  found: boolean;
  /** Where the file is in the vault, when the workspace knows. */
  path?: string;
  /** Opens the file, if it is there. */
  open(how: LinkHow): void;
}

const withoutExtension = (target: string) => target.replace(/^.*\//, "").replace(/\.[^.]+$/, "");

/** How a link to `target` reads and opens when it names a file; null for a page. */
export function fileMention(links: LinkProvider, target: string): FileMention | null {
  if (!isFileTarget(target)) return null;
  if (isDeckTarget(target)) {
    const deck = findDeck(links.decks?.() ?? [], target);
    return { title: deck?.title ?? withoutExtension(target), icon: "icon:present", found: deck !== undefined, ...(deck && { path: deck.path }), open: (how) => deck && links.openDeck?.(deck.path, how) };
  }
  if (isDiagramTarget(target)) {
    const diagram = findDiagram(links.diagrams?.() ?? [], target);
    return { title: diagram?.title ?? withoutExtension(target.replace(/\.svg$/i, "")), icon: "icon:diagram", found: diagram !== undefined, ...(diagram && { path: diagram.path }), open: (how) => diagram && links.openDiagram?.(diagram.path, how) };
  }
  if (isBoardTarget(target)) {
    const board = findBoard(links.boards?.() ?? [], target);
    return { title: board?.title ?? withoutExtension(target), icon: "icon:board", found: board !== undefined, ...(board && { path: board.path }), open: (how) => board && links.openBoard?.(board.path, how) };
  }
  if (isDatabaseTarget(target)) {
    const database = findDatabase(links.databases?.() ?? [], target);
    return { title: database ? `#${database.tag}` : withoutExtension(target), icon: "icon:database", found: database !== undefined, ...(database && { path: database.path }), open: (how) => database && links.openDatabase?.(database.tag, how) };
  }
  return { title: target, icon: "icon:attach", found: true, open: (how) => void links.openFile?.(target, how) };
}
