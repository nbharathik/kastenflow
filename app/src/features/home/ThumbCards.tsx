// The whiteboard and deck cards, for the person who turns them on with
// Customize. Each row carries a small picture, and the picture's code is the
// heaviest thing Home can load (a deck's first slide comes from the Slides
// package), so these two load apart from the other cards.

import { useBoards } from "../boards/store";
import { DashCard } from "../dashboard/DashCard";
import { MiniList, SeeAll } from "../dashboard/Minis";
import { BoardMini, DeckMini } from "../dashboard/NoteTiles";
import { useDecks } from "../slides/store";
import { useWorkspace } from "../workspace/store";

export function ThumbCard({ id }: { id: "boards" | "decks" }) {
  return id === "boards" ? <Boards /> : <Decks />;
}

/** The four newest whiteboards, a small sketch and a line each; "Show all" for the rest. */
function Boards() {
  const boards = useBoards((s) => s.list);
  if (boards.length === 0) return null;
  return (
    <DashCard title="Whiteboards" icon="board" count={boards.length} actions={<SeeAll label="All whiteboards" run={() => useWorkspace.getState().go({ view: "boards" })} />}>
      <MiniList items={boards} memory="boards:home" row={(board) => <BoardMini board={board} />} />
    </DashCard>
  );
}

/** The four newest decks, each with its first slide small; "Show all" for the rest. */
function Decks() {
  const decks = useDecks((s) => s.list);
  if (decks.length === 0) return null;
  return (
    <DashCard title="Decks" icon="present" count={decks.length} actions={<SeeAll label="All decks" run={() => useWorkspace.getState().go({ view: "slides" })} />}>
      <MiniList items={decks} memory="decks:home" row={(deck) => <DeckMini deck={deck} />} />
    </DashCard>
  );
}
