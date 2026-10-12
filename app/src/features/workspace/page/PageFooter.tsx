import { useEffect, useRef, useState, type MouseEvent } from "react";

import { relativeTime } from "../../../lib/dates";
import type { Backlink, NoteMeta, VaultClient } from "../../../lib/vault/types";
import { Disclosure } from "../../../ui/Disclosure";
import { DayActivity } from "../../journal/DayActivity";
import { iconOf, readable, titleOf } from "../names";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { openMenuHandlers } from "../../../shell/open-menu";
import { howFromPage } from "../open-how";
import { useWorkspace } from "../store";
import { childrenOf } from "../tree";

/** Below the page, folded away until asked: its sub-pages, the pages that
 * link to it, what else happened that day (on a journal day) and the page's
 * details. Each toggle remembers whether it was left open. */
export function PageFooter({ note, notes, client }: { note: NoteMeta; notes: NoteMeta[]; client: VaultClient }) {
  const children = note.kind === "journal" ? [] : childrenOf(notes, note);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  // Saving this page cannot change what links to it; other notes can.
  const others = useOthers(notes, note.path);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client.backlinks(note.path).then(
        (found) => !cancelled && setBacklinks(found.filter((b) => b.path !== note.path)),
        () => {},
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, note.title, note.path, others]);

  return (
    <footer className="kasten-page-footer" aria-label="About this page">
      {children.length > 0 && (
        <Disclosure id="page.subpages" title="Sub-pages" meta={children.length}>
          {children.map((child) => (
            <FooterLink key={child.path} note={child} from={note.path} />
          ))}
        </Disclosure>
      )}
      {backlinks.length > 0 && (
        <Disclosure id="page.backlinks" title={`${backlinks.length} ${backlinks.length === 1 ? "page links" : "pages link"} here`}>
          {backlinks.map((link) => (
            <FooterLink key={link.path} note={{ path: link.path, title: link.title, icon: link.icon, kind: "page" }} from={note.path} detail={readable(link.snippet)} />
          ))}
        </Disclosure>
      )}
      {note.kind === "journal" && <DayActivity day={note.title} />}
      <Disclosure id="page.details" title="Details">
        <Details note={note} />
      </Disclosure>
    </footer>
  );
}

type Linked = Pick<NoteMeta, "path" | "title" | "icon" | "kind">;

/** A sub-page or backlink: a plain click follows the page's `opens` key or
 * Settings, a click with a key what the key says; right-click shows the
 * Open menu and the middle button opens a tab. */
function FooterLink({ note, from, detail }: { note: Linked; from: string; detail?: string }) {
  const openPath = useWorkspace((s) => s.openPath);
  return (
    <button type="button" className="kasten-footer-link" onClick={(e: MouseEvent) => openPath(note.path, howFromPage(e, from))} {...openMenuHandlers(note.path)}>
      <span className="kasten-footer-link-title">
        <IconOrEmoji icon={iconOf(note)} /> {titleOf(note)}
      </span>
      {detail && <span className="kasten-footer-link-detail">{detail}</span>}
    </button>
  );
}

const KINDS: Record<string, string> = { page: "Page", card: "Card", journal: "Journal day", project: "Project", highlight: "Highlight", chat: "Chat" };

/** When the page was made and last changed, how long it is and where its file lives. */
function Details({ note }: { note: NoteMeta }) {
  const made = note.created ? Date.parse(note.created) : NaN;
  const changed = note.updated ? Date.parse(note.updated) : note.modified;
  const rows: [string, string][] = [
    ["Type", KINDS[note.kind] ?? note.kind],
    ...(Number.isNaN(made) ? [] : ([["Created", when(made)]] as [string, string][])),
    ["Edited", when(changed)],
    ["Words", note.words.toLocaleString()],
    ["File", note.path],
  ];
  return (
    <dl className="kasten-page-details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={label === "File" ? value : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function when(millis: number): string {
  return `${new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · ${relativeTime(millis)}`;
}

/** A value that changes when any note but `path` changes. */
function useOthers(notes: NoteMeta[], path: string): NoteMeta[] {
  const last = useRef(notes);
  const prev = last.current;
  if (prev !== notes && !onlyChanged(prev, notes, path)) last.current = notes;
  return last.current;
}

function onlyChanged(prev: NoteMeta[], next: NoteMeta[], path: string): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i] && next[i]!.path !== path) return false;
  return true;
}
