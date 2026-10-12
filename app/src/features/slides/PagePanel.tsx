// A page of the vault, read-only, in the panel a presentation opens at the side when a link to a page is followed. It is drawn by the
// same renderer that draws an embedded page (Markdown read into blocks and set as React elements: nothing in a page can run), in the
// app's own colours. Links in it go on: another page replaces this one (with a way back), the web opens in the system browser or a tab.

import { PageView, type PagePanelProps, parsePageLink } from "@kasten-slides/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { fileUrl } from "../../lib/vault/file-url";
import { openWeb } from "../../shell/web-links";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";

/** The panel is the app's own look, not a deck's: the colours of the page come from the app's tokens. */
const LOOK = {
  "--pv-ink": "var(--color-ink)",
  "--pv-muted": "var(--color-muted)",
  "--pv-accent": "var(--color-accent)",
  "--pv-line": "var(--color-line-strong)",
  "--pv-wash": "var(--color-hover)",
  "--pv-mono": "var(--font-mono, ui-monospace, monospace)",
  background: "var(--color-canvas)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  minHeight: "100%",
} as CSSProperties;

type Shown = { status: "loading" } | { status: "missing" } | { status: "ready"; title: string; markdown: string };

export function PagePanel({ path: first, section: heading }: PagePanelProps) {
  const [trail, setTrail] = useState<{ path: string; section: string | null }[]>([{ path: first, section: heading }]);
  const [shown, setShown] = useState<Shown>({ status: "loading" });
  const body = useRef<HTMLDivElement>(null);
  const here = trail[trail.length - 1]!;

  // Another link asked for while the panel is open starts the trail again.
  useEffect(() => {
    setTrail([{ path: first, section: heading }]);
  }, [first, heading]);

  useEffect(() => {
    const client = useWorkspace.getState().client;
    let live = true;
    setShown({ status: "loading" });
    if (!client) {
      setShown({ status: "missing" });
      return;
    }
    client.read(here.path).then(
      (note) => live && setShown({ status: "ready", title: titleOf(note.meta), markdown: splitFrontmatter(note.text).body }),
      () => live && setShown({ status: "missing" }),
    );
    return () => {
      live = false;
    };
  }, [here.path]);

  // The heading a link names comes into view.
  useEffect(() => {
    if (shown.status !== "ready" || !here.section) return;
    const wanted = here.section.trim().toLowerCase();
    const found = [...(body.current?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [])].find((h) => (h.textContent ?? "").trim().toLowerCase() === wanted);
    found?.scrollIntoView?.({ block: "start" });
  }, [shown, here.section]);

  const onLink = useMemo(
    () => (href: string) => {
      const page = parsePageLink(href);
      if (page) setTrail((now) => [...now, page]);
      else if (/^https?:/i.test(href)) openWeb(href);
    },
    [],
  );

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-canvas)" }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5 pr-16">
        {trail.length > 1 && (
          <button type="button" className="rounded-md px-2 py-1 text-13 text-muted hover:bg-hover" onClick={() => setTrail((now) => now.slice(0, -1))} aria-label="Back to the page before">
            Back
          </button>
        )}
        <h2 className="min-w-0 truncate text-14 font-semibold">{shown.status === "ready" ? shown.title : "Page"}</h2>
      </header>
      <div ref={body} className="min-h-0 flex-1 overflow-auto" role="document" aria-label="Page">
        {shown.status === "loading" ? <p className="p-5 text-13 text-muted">Opening…</p> : null}
        {shown.status === "missing" ? <p className="p-5 text-13 text-muted">This page could not be found. It may have been moved or deleted.</p> : null}
        {shown.status === "ready" ? (
          <div style={LOOK}>
            <PageView markdown={shown.markdown} imageUrl={(src) => fileUrl(src) ?? undefined} onLink={onLink} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
