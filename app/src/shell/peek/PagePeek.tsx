import "./peek.css";

import { Suspense, useEffect } from "react";

import { longDay } from "../../lib/dates";
import { LazyBoard } from "../../features/boards/canvas/LazyBoard";
import { boxOf } from "../../features/browser/bounds";
import { useOccludes } from "../../features/browser/occlusion";
import { BlankDay, journalDayOf } from "../../features/journal/BlankDay";
import { useBoards } from "../../features/boards/store";
import { usePeek, type Peek } from "../../features/peek/store";
import { useDecks } from "../../features/slides/store";
import { useSources } from "../../features/sources/store";
import { LazyNotePage } from "../../features/workspace/page/LazyNotePage";
import { useWorkspace } from "../../features/workspace/store";
import type { Place } from "../../features/workspace/tabs";
import { IconButton } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { PdfReader } from "../lazy-views";
import { tabFace } from "../TabStrip";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { lineIcon } from "../../ui/glyph";
import { noteAt } from "../../features/workspace/tree";

const placeOf = (path: string): Place => ({ view: path.endsWith(".canvas") ? "boards" : path.endsWith(".deck") ? "slides" : path.endsWith(".drawio") ? "diagrams" : /\.pdf$/i.test(path) ? "highlights" : "page", path });

/** A page shown over the view it was picked in (Notion's peeks): in the
 * center as a modal, or at the side. Escape or a click outside closes it;
 * its header opens it as a full page or moves it. */
export function PagePeek() {
  const peek = usePeek((s) => s.peek);
  if (!peek) return null;
  // A deck or a diagram is not shown in a peek: it opens as a tab of its own.
  if (peek.path.endsWith(".deck") || peek.path.endsWith(".drawio")) return <DeckInstead path={peek.path} />;
  return peek.mode === "center" ? <CenterPeek peek={peek} /> : <SidePeek peek={peek} />;
}

/** Where a peek at a deck ends up, should anything ask for one: a full tab. */
function DeckInstead({ path }: { path: string }) {
  useEffect(() => {
    usePeek.getState().close();
    useWorkspace.getState().openPath(path, "tab");
  }, [path]);
  return null;
}

function CenterPeek({ peek }: { peek: Peek }) {
  return (
    <Modal label="Page peek" onClose={() => usePeek.getState().close()} className="kasten-peek-center">
      <PeekHeader peek={peek} />
      <PeekBody path={peek.path} />
    </Modal>
  );
}

function SidePeek({ peek }: { peek: Peek }) {
  // Over a browser tab's page it would be hidden behind it (a center peek is a Modal, which steps it aside).
  useOccludes(true, () => {
    const side = document.querySelector(".kasten-peek-side");
    return side ? boxOf(side.getBoundingClientRect()) : null;
  });
  useEffect(() => {
    // A press in the views behind closes it; menus and pickers the page
    // opens float outside them, so using those keeps it open.
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-peek-closes]")) usePeek.getState().close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) usePeek.getState().close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <aside className="kasten-peek-side" role="dialog" aria-label="Page peek">
      <PeekHeader peek={peek} />
      <PeekBody path={peek.path} />
    </aside>
  );
}

function PeekHeader({ peek }: { peek: Peek }) {
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  const sources = useSources((s) => s.list) ?? [];
  const place = placeOf(peek.path);
  // A journal page is named by its day, written or not.
  const day = journalDayOf(peek.path);
  const face = day ? { icon: lineIcon("journal"), title: longDay(day) } : tabFace(place, notes, boards, sources, decks);
  const { close, setMode } = usePeek.getState();
  return (
    <header className="kasten-peek-head">
      <IconButton icon="expand" label="Open as full page" size="sm" onClick={() => {
        close();
        useWorkspace.getState().openPath(peek.path);
      }} />
      {peek.mode === "center" ? (
        <IconButton icon="peek-side" label="Open in side peek" size="sm" onClick={() => setMode("side")} />
      ) : (
        <IconButton icon="peek-center" label="Open in center peek" size="sm" onClick={() => setMode("center")} />
      )}
      <span className="kasten-peek-title">
        <IconOrEmoji icon={face.icon} /> {face.title}
      </span>
      <IconButton icon="close" label="Close" size="sm" onClick={close} />
    </header>
  );
}

function PeekBody({ path }: { path: string }) {
  const client = useWorkspace((s) => s.client);
  // A day picked on the calendar that nobody wrote in: made on writing.
  const day = journalDayOf(path);
  const blank = useWorkspace((s) => day !== null && !noteAt(s.notes, path));
  if (!client) return null;
  if (day && blank) return <div className="kasten-peek-body"><BlankDay day={day} onMade={(made) => made !== path && usePeek.getState().open(made)} /></div>;
  const place = placeOf(path);
  return (
    <div className="kasten-peek-body">
      {place.view === "boards" ? (
        <LazyBoard key={path} path={path} />
      ) : place.view === "highlights" ? (
        <Suspense fallback={null}>
          <PdfReader key={path} path={path} />
        </Suspense>
      ) : (
        // A link followed in the peek shows its page here, as in Notion.
        <LazyNotePage key={path} client={client} path={path} peek linksOpen="peek" />
      )}
    </div>
  );
}
