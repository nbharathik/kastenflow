// A page's links in the right panel: notes linking here, the pages this one
// links to (and links that find none), notes relating to this one through
// a property, notes naming it without a link, each with "Link it", and
// notes about the same things.

import "./links.css";

import { lazy, memo, Suspense, useEffect, useState, type ReactNode } from "react";

import type { Backlink, NoteMeta, VaultClient } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { dragNotes } from "../../workspace/drag";
import { directoryOf, placeOf } from "../../workspace/links";
import { iconOf, readable } from "../../workspace/names";
import { filesChanged } from "../../workspace/page/open-page";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { whereIfShared } from "../../workspace/where";
import { errorText, type PanelPage } from "../page-edit";
import { linkMention } from "./link-mention";
import { LinksOut } from "./LinksOut";
import { OnBoards } from "./OnBoards";
import { RelatedFrom } from "./RelatedFrom";
import { SimilarNotes } from "./SimilarNotes";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";

/** The page's small graph, loaded when a Links tab first opens: the canvas code stays off the start-up path. */
const LocalGraph = lazy(() => import("../../graph/LocalGraph").then((m) => ({ default: m.LocalGraph })));

/** Changes when any other note changes, so the lists are fetched again then,
 * not on every save of this one. */
function othersStamp(notes: NoteMeta[], path: string): string {
  let count = 0;
  let latest = 0;
  for (const n of notes) {
    if (n.path === path) continue;
    count++;
    if (n.modified > latest) latest = n.modified;
  }
  return `${count}:${latest}`;
}

/** Links the first plain mention of `note` in the note at `path`, by path
 * when its title from there would find another page; false when none is left. */
export async function linkIn(client: VaultClient, path: string, note: NoteMeta): Promise<boolean> {
  const file = await client.read(path);
  const named = directoryOf(useWorkspace.getState().notes).targetFor(note, placeOf(file.meta));
  const next = linkMention(splitFrontmatter(file.text).body, note.title, named.alias ? named.target : undefined);
  if (next === null) return false;
  const saved = await client.saveBody(path, next, file.hash);
  useWorkspace.getState().noteChanged(saved.note.meta);
  filesChanged([path]);
  if (saved.status === "conflict") throw new Error(`“${file.meta.title}” changed meanwhile, so the link went into a copy`);
  return true;
}

/** The snippet with the title picked out. */
function Snippet({ text, title }: { text: string; title: string }) {
  const plain = readable(text);
  const at = title ? plain.toLowerCase().indexOf(title.toLowerCase()) : -1;
  if (at < 0) return <span className="kasten-link-snippet">{plain}</span>;
  return (
    <span className="kasten-link-snippet">
      {plain.slice(0, at)}
      <mark>{plain.slice(at, at + title.length)}</mark>
      {plain.slice(at + title.length)}
    </span>
  );
}

function LinkRow({ link, title, action }: { link: Backlink; title: string; action?: ReactNode }) {
  const openPath = useWorkspace((s) => s.openPath);
  // Where the page lives, when another page shares its title.
  const where = useWorkspace((s) => {
    const note = noteAt(s.notes, link.path);
    return note ? whereIfShared(note, s.notes) : undefined;
  });
  return (
    <li className="kasten-link" draggable onDragStart={(e) => dragNotes(e, [link.path])}>
      <button type="button" className="kasten-link-open" title={`Open ${link.title}${where ? ` (${where})` : ""}`} onClick={() => openPath(link.path)}>
        <span className="kasten-link-title">
          <IconOrEmoji icon={iconOf({ icon: link.icon, kind: "page" })} /> {link.title}
          {where && <span className="kasten-link-where"> · {where}</span>}
        </span>
        {link.snippet && <Snippet text={link.snippet} title={title} />}
      </button>
      {action}
    </li>
  );
}

interface Lists {
  backlinks: Backlink[];
  mentions: Backlink[];
}

export const LinksTab = memo(function LinksTab({ note, page }: { note: NoteMeta; page: PanelPage }) {
  const { client } = page;
  const stamp = useWorkspace((s) => othersStamp(s.notes, note.path));
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      Promise.all([client.backlinks(note.path), client.mentions(note.title, note.path)]).then(
        ([backlinks, mentions]) => {
          if (!live) return;
          setLists({ backlinks: backlinks.filter((b) => b.path !== note.path), mentions });
          setError(null);
        },
        (err: unknown) => live && setError(errorText(err)),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, note.title, note.path, stamp, round]);

  const { toast } = useWorkspace.getState();
  const link = async (mention: Backlink) => {
    setBusy(mention.path);
    try {
      const done = await linkIn(client, mention.path, note);
      toast(done ? `Linked “${note.title}” in “${mention.title}”` : `“${mention.title}” has no plain mention of “${note.title}” to link`);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(null);
      setRound((r) => r + 1);
    }
  };
  const linkAll = async (mentions: Backlink[]) => {
    setBusy("all");
    let linked = 0;
    for (const mention of mentions) {
      try {
        if (await linkIn(client, mention.path, note)) linked++;
      } catch (err) {
        toast(errorText(err));
      }
    }
    setBusy(null);
    setRound((r) => r + 1);
    const noun = (n: number) => `${n} mention${n === 1 ? "" : "s"}`;
    toast(linked === mentions.length ? `Linked ${noun(linked)}` : `Linked ${linked} of ${noun(mentions.length)}`);
  };

  if (error) return <p className="kasten-panel-empty">Links could not be read: {error}</p>;
  if (!lists) return <p className="kasten-panel-empty">Finding links…</p>;
  const { backlinks, mentions } = lists;

  return (
    <>
      <Suspense fallback={null}>
        <LocalGraph note={note} />
      </Suspense>
      <OnBoards client={client} path={note.path} />
      <section className="kasten-panel-section" aria-label="Backlinks">
        <h3 className="kasten-panel-label">
          <span>
            Backlinks <span className="kasten-panel-count">{backlinks.length}</span>
          </span>
        </h3>
        {backlinks.length === 0 ? (
          <p className="kasten-panel-empty">No pages link here yet.</p>
        ) : (
          <ul className="kasten-links">
            {backlinks.map((b) => (
              <LinkRow key={b.path} link={b} title={note.title} />
            ))}
          </ul>
        )}
      </section>
      <LinksOut client={client} note={note} />
      <RelatedFrom client={client} note={note} />
      <section className="kasten-panel-section" aria-label="Unlinked mentions">
        <h3 className="kasten-panel-label">
          <span>
            Unlinked mentions <span className="kasten-panel-count">{mentions.length}</span>
          </span>
          {mentions.length > 0 && (
            <button type="button" className="kasten-panel-button" disabled={busy !== null} onClick={() => void linkAll(mentions)}>
              Link all
            </button>
          )}
        </h3>
        {mentions.length === 0 ? (
          <p className="kasten-panel-empty">No page names “{note.title}” without linking it.</p>
        ) : (
          <ul className="kasten-links">
            {mentions.map((m) => (
              <LinkRow
                key={m.path}
                link={m}
                title={note.title}
                action={
                  <button
                    type="button"
                    className="kasten-panel-button kasten-link-it"
                    aria-label={`Link it in ${m.title}`}
                    disabled={busy !== null}
                    onClick={() => void link(m)}
                  >
                    {busy === m.path ? "Linking…" : "Link it"}
                  </button>
                }
              />
            ))}
          </ul>
        )}
      </section>
      <SimilarNotes client={client} path={note.path} stamp={stamp} />
    </>
  );
});
