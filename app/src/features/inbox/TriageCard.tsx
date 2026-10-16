// The card triage shows: its title, where it came from, the whole text drawn
// from its Markdown (in a box that scrolls when it is long) and its tags.

import { useEffect, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Markdown } from "../chat/markdown/Markdown";
import { showTag } from "../library/request";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { iconOf, titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { DuplicateNotice } from "./DuplicateNotice";
import { SourceLine } from "./SourceLine";

export function TriageCard({ card }: { card: NoteMeta }) {
  return (
    <article key={card.path} className="mt-3 rounded-2xl border border-line bg-canvas p-6 shadow-lift [animation:kasten-rise-in_var(--motion-base)_var(--ease-standard)]">
      <h2 className="flex items-center gap-2 text-20 font-semibold">
        <IconOrEmoji icon={iconOf(card)} />
        {titleOf(card)}
      </h2>
      <SourceLine card={card} />
      <DuplicateNotice card={card} />
      <FullText card={card} />
      {card.tags.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {card.tags.map((tag) => (
            <button key={tag} type="button" title={`Cards tagged #${tag}`} onClick={() => showTag(tag)} className="rounded bg-soft px-1.5 py-0.5 text-12 font-medium text-accent hover:underline">
              #{tag}
            </button>
          ))}
        </p>
      )}
    </article>
  );
}

/** The whole capture, drawn from its Markdown; the excerpt stands in until it has loaded. */
function FullText({ card }: { card: NoteMeta }) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setBody(null);
    useWorkspace
      .getState()
      .client?.read(card.path)
      .then(
        (file) => current && setBody(splitFrontmatter(file.text).body.trim()),
        () => current && setBody(null),
      );
    return () => {
      current = false;
    };
  }, [card.path, card.modified]);
  const text = body ?? card.excerpt;
  if (!text) return <p className="mt-3 min-h-12 text-14 leading-relaxed text-muted">No text yet.</p>;
  return (
    <div role="region" aria-label="The whole card" className="mt-3 max-h-[50vh] min-h-12 overflow-y-auto text-14 leading-relaxed">
      {body === null ? <p className="text-muted">{text}</p> : <Markdown text={body} onOpenTitle={(title, how) => void useWorkspace.getState().openTitle(title, how)} />}
    </div>
  );
}
