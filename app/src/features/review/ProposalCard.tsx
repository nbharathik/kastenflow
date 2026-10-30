// One proposal as a card: who proposed it and when, the note and what would
// change, why it waits (the guardrail), the agent's own note, the change
// itself, and Accept or Reject. A and R decide while the card has focus;
// J and K move between cards.

import { Suspense, lazy, useMemo, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteMeta, Proposal } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { DiagramProposalChange, isDiagramProposal } from "../diagrams/ai/ProposalChange";
import { iconOf, titleOf } from "../workspace/names";
import type { CardState, Verb } from "./decide";
import { isDeckProposal } from "./deck/deck-changes";
import { diffLines } from "./diff";
import { DiffStats, DiffView, type DiffMode } from "./DiffView";
import { millisOf } from "./group";
import { BUTTON, Callout, ClientBadge, Kbd, PRIMARY } from "./ui";
import { descriptionOf, opWords } from "./words";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { lineIcon } from "../../ui/glyph";

/** A deck proposal is drawn as slides. The slides code is large, so it loads with the first one shown. */
const DeckChange = lazy(() => import("./deck/DeckChange"));

interface CardProps {
  proposal: Proposal;
  state: CardState;
  mode: DiffMode;
  /** The target note, when it is a note that exists. */
  note: NoteMeta | undefined;
  onDecide(verb: Verb): void;
  onOpen(path: string): void;
  /** Moves focus to the next (1) or previous (-1) card. */
  onStep(delta: 1 | -1): void;
  ref?: Ref<HTMLElement>;
  /** Draws the change in place of the card's own (the chat draws a text change hunk by hunk). */
  change?: ReactNode;
  /** Takes the place of Accept and Reject (the chat's stale card and its per-hunk Keep). */
  footer?: ReactNode;
}

const typing = (target: EventTarget) => {
  const el = target as HTMLElement;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
};

export function ProposalCard({ proposal: p, state, mode, note, onDecide, onOpen, onStep, ref, change, footer }: CardProps) {
  const words = opWords(p.op);
  const created = millisOf(p.created);
  const busy = Boolean(state.busy);

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "a" || key === "r") {
      if (!busy) onDecide(key === "a" ? "accept" : "reject");
    } else if (key === "j" || key === "k") onStep(key === "j" ? 1 : -1);
    else return;
    event.preventDefault();
  };

  return (
    <article
      ref={ref}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={`${words}${p.target ? ` in ${p.target.title}` : ""}, proposed by ${p.client}`}
      aria-busy={busy}
      data-proposal={p.id}
      className="rounded-lg border border-line bg-canvas shadow-(--kr-shadow) outline-none transition-[border-color,box-shadow] focus-visible:border-accent/50 focus-visible:ring-3 focus-visible:ring-accent/15"
    >
      <div className="px-4 pb-1 pt-3.5">
        <div className="flex items-center gap-2 text-12 text-muted">
          <ClientBadge client={p.client} />
          <time dateTime={p.created} title={created === null ? p.created : new Date(created).toLocaleString()}>
            {created === null ? p.created : relativeTime(created)}
          </time>
        </div>
        <h3 className="mt-2 text-16 font-semibold leading-snug">
          <Target proposal={p} note={note} onOpen={onOpen} />
        </h3>
        <p className="mt-0.5 text-13 text-muted">{words}</p>
      </div>

      <div className="space-y-2.5 px-4 pt-2">
        <Callout tone="warn" icon="alert">
          {p.reason}
        </Callout>
        {p.note && (
          <p className="flex items-start gap-2 text-13 leading-snug">
            <Icon name="chat" className="mt-px size-4 text-muted" />
            <span>
              <span className="text-muted">Agent's note: </span>
              {p.note}
            </span>
          </p>
        )}
        {change ?? <Change proposal={p} mode={mode} />}
        {state.failed && (
          <Callout tone="bad" icon="alert" role="alert">
            <span className="font-medium">Could not {state.failed.verb}.</span> {state.failed.reason}
          </Callout>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        {footer ?? (
          <>
            <button type="button" className={PRIMARY} disabled={busy} aria-keyshortcuts="A" onClick={() => onDecide("accept")}>
              {state.busy === "accept" ? "Accepting…" : "Accept"}
              <Kbd onAccent>A</Kbd>
            </button>
            <button type="button" className={BUTTON} disabled={busy} aria-keyshortcuts="R" onClick={() => onDecide("reject")}>
              {state.busy === "reject" ? "Rejecting…" : "Reject"}
              <Kbd>R</Kbd>
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** The note the proposal is about; its title opens it. */
function Target({ proposal: p, note, onOpen }: { proposal: Proposal; note: NoteMeta | undefined; onOpen(path: string): void }) {
  if (!p.target) return <span>{p.op.kind === "create_deck" ? "New deck" : p.op.kind === "request_smart_pages" ? "Turn on smart pages?" : "New note"}</span>;
  if (p.target.path.endsWith(".deck")) {
    return (
      <button type="button" onClick={() => onOpen(p.target!.path)} title={`Open ${p.target.path}`} className="flex max-w-full items-center gap-2 rounded text-left hover:underline hover:decoration-line hover:underline-offset-4">
        <IconOrEmoji icon={lineIcon("present")} />
        <span className="truncate">{p.target.title}</span>
      </button>
    );
  }
  if (!note) {
    return (
      <span className="flex items-center gap-2">
        <IconOrEmoji icon={lineIcon(p.target.path.endsWith(".canvas") ? "board" : "page")} />
        {p.target.title}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(note.path)} title={`Open ${note.path}`} className="flex max-w-full items-center gap-2 rounded text-left hover:underline hover:decoration-line hover:underline-offset-4">
      <IconOrEmoji icon={iconOf(note)} />
      <span className="truncate">{titleOf(note)}</span>
    </button>
  );
}

/** The change: slides for a deck, two pictures for a diagram, else a diff when there is text after it, else the core's words. */
function Change({ proposal: p, mode }: { proposal: Proposal; mode: DiffMode }) {
  if (isDiagramProposal(p)) return <DiagramProposalChange proposal={p} />;
  if (!isDeckProposal(p)) return <TextChange proposal={p} mode={mode} />;
  return (
    <Suspense fallback={<p aria-busy="true" className="rounded-md border border-line bg-panel px-3 py-2 text-13 text-muted">{descriptionOf(p.diff) || "Reading the slides…"}</p>}>
      <DeckChange proposal={p} />
    </Suspense>
  );
}

function TextChange({ proposal: p, mode }: { proposal: Proposal; mode: DiffMode }) {
  const lines = useMemo(() => (p.after === null ? null : diffLines(p.before ?? "", p.after)), [p.before, p.after]);
  const words = descriptionOf(p.diff);
  if (!lines) {
    return <p className="rounded-md border border-line bg-panel px-3 py-2 text-13">{words || p.diff || "No details."}</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-12 text-muted">
        <span className="min-w-0 flex-1 truncate">{words || (p.before === null ? "New text" : p.target?.path ?? "Changes")}</span>
        <DiffStats lines={lines} />
      </div>
      <div className="max-h-[30rem] overflow-auto">
        <DiffView lines={lines} mode={mode} label={`Changes to ${p.target?.title ?? "the new note"}`} />
      </div>
    </div>
  );
}
