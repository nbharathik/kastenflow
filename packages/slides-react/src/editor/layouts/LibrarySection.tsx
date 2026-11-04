import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useMemo, useState } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { Icon } from "../ui/Icon.tsx";
import type { EditorSession } from "../session/session.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import { copyLibraryLayout, copyOf } from "./library-ops.ts";
import type { LibraryItem, LibraryView } from "./library-state.ts";
import { drawnWith } from "./library.ts";
import "./layouts.css";
import "./library.css";

interface LibrarySectionProps {
  session: EditorSession;
  /** The deck the layouts are drawn in (they take on its colours and fonts). */
  deck: Deck;
  imageUrl: ImageUrl;
  view: LibraryView;
}

/**
 * The layout manager's list of "My layouts": what every deck can use. Each can be added to this deck (a copy; a deck that has one already
 * does not get a second) or taken out of the library, which moves its file to the trash and leaves the copies decks hold alone.
 */
export function LibrarySection({ session, deck, imageUrl, view }: LibrarySectionProps): JSX.Element | null {
  const library = session.host.layoutLibrary;
  const [taking, setTaking] = useState<LibraryItem | null>(null);
  const drawn = useMemo(() => drawnWith(deck, view.items.map((item) => item.layout)), [deck, view.items]);
  if (!library || view.state === "none") return null;

  const take = async (item: LibraryItem) => {
    setTaking(null);
    try {
      await library.remove?.(item.entry.id);
      session.host.notify?.(`Took “${item.layout.label}” out of My layouts. Decks that have a copy keep it.`);
    } catch (error) {
      session.host.notify?.(`Could not take it out of My layouts: ${error instanceof Error ? error.message : String(error)}`);
    }
    view.reload();
  };

  return (
    <section className="ks-lm-library" aria-label="My layouts">
      <h3 className="ks-lp-heading">My layouts (all decks)</h3>
      {view.state === "loading" && view.items.length === 0 ? <p className="ks-lp-note">Loading your layouts…</p> : null}
      {view.state === "failed" ? (
        <p className="ks-lp-note" role="alert">
          Your layouts could not be loaded.{" "}
          <button type="button" className="ks-btn ks-lp-link" onClick={view.reload}>
            Try again
          </button>
        </p>
      ) : null}
      {view.state === "ready" && view.items.length === 0 ? <p className="ks-lp-note">Nothing here yet. Save a layout for all decks, or add one of this deck’s layouts, and it shows up in every deck.</p> : null}
      <ul className="ks-lm-list" aria-label="Layouts kept for every deck">
        {view.items.map((item) => {
          const here = copyOf(deck, item.entry.id);
          return (
            <li key={item.entry.id} className={`ks-lm-row${taking?.entry.id === item.entry.id ? " is-open" : ""}`} data-library={item.entry.id}>
              <LayoutThumb deck={drawn} layout={item.layout.layout} width={112} imageUrl={imageUrl} />
              <div className="ks-lm-main">
                <span className="ks-lm-name">{item.layout.label}</span>
                <span className="ks-lm-meta">{here ? <span className="ks-lm-badge">In this deck</span> : <span>Not in this deck yet</span>}</span>
              </div>
              <div className="ks-lm-actions" role="group" aria-label={`Actions for ${item.layout.label}`}>
                <button type="button" className="ks-btn ks-icon-btn" aria-label={here ? `${item.layout.label} is in this deck already` : `Add ${item.layout.label} to this deck`} data-tip={here ? "This deck has a copy" : "Add a copy to this deck"} disabled={here !== undefined} onClick={() => copyLibraryLayout(session, item.layout)}>
                  <Icon name="download" />
                </button>
                {library.remove ? (
                  <button type="button" className="ks-btn ks-icon-btn" aria-label={`Take ${item.layout.label} out of My layouts`} data-tip="Take out of My layouts" onClick={() => setTaking(item)}>
                    <Icon name="trash" />
                  </button>
                ) : null}
              </div>
              {taking?.entry.id === item.entry.id ? (
                <div className="ks-lm-confirm" role="group" aria-label={`Take ${item.layout.label} out of My layouts`}>
                  <span>It goes to the trash. Decks that have a copy keep it.</span>
                  <button type="button" className="ks-btn ks-lp-link" onClick={() => void take(item)}>
                    Take it out
                  </button>
                  <button type="button" className="ks-btn ks-lp-link" onClick={() => setTaking(null)}>
                    Keep it
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
