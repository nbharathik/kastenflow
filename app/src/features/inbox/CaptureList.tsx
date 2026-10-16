import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { dayFrom, shortDay } from "../../lib/dates";
import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { openMenuHandlers } from "../../shell/open-menu";
import { byDay, caughtAt } from "../workspace/capture";
import { dragNotes } from "../workspace/drag";
import { iconOf, titleOf } from "../workspace/names";
import { howFrom, useWorkspace } from "../workspace/store";
import { BoardAction, TagAction, TOOL } from "./CardActions";
import { PickedBar } from "./PickedBar";
import { deferredUntil } from "./queue";
import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";

type Open = { path: string; what: "tag" | "board" } | null;

/** The hover tools float over the row's right end, so showing them moves
 * no text and the row keeps its height; the time under them fades out. */
const TOOLS = "absolute right-3 top-[7px] flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 shadow-card ring-1 ring-line transition-[opacity,visibility]";
const SHOWN = "visible opacity-100";
const ON_HOVER = "invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100";

/** A thought long enough to read as a page, not a line. */
const LONG_WORDS = 60;

const time = (card: NoteMeta) => new Date(caughtAt(card)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The row whose title button holds `path`, if it is drawn. */
function rowButton(list: HTMLElement | null, path: string): HTMLElement | null {
  return [...(list?.querySelectorAll<HTMLElement>("[data-capture]") ?? [])].find((el) => el.dataset.capture === path) ?? null;
}

/** The Inbox's captures, by the day they were caught: a short
 * thought is one line; a longer one shows the start of its body. Each can be
 * tagged, put on a board, moved, made a page or marked done, one at a time
 * or several picked at once. On a row, arrow keys (or J and K) move, X
 * picks, and T, B, M, P and D act as they do in triage. */
export function CaptureList({ cards }: { cards: NoteMeta[] }) {
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<Open>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const clear = useCallback(() => setPicked([]), []);
  const toggle = (path: string) => setPicked((was) => (was.includes(path) ? was.filter((p) => p !== path) : [...was, path]));
  // A capture that left the Inbox is no longer picked.
  const live = picked.filter((path) => cards.some((card) => card.path === path));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const path = target.dataset.capture;
    if (!path || event.ctrlKey || event.metaKey || event.altKey) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-capture]") ?? [])];
    const at = rows.indexOf(target);
    const go = (i: number) => rows[Math.max(0, Math.min(i, rows.length - 1))]?.focus();
    // After a card leaves the Inbox, the focus goes to the one below it.
    const next = (rows[at + 1] ?? rows[at - 1])?.dataset.capture;
    const thenNext = () => next && rowButton(list.current, next)?.focus();
    const { convert, trash } = useWorkspace.getState();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "ArrowDown" || key === "j") go(at + 1);
    else if (key === "ArrowUp" || key === "k") go(at - 1);
    else if (key === "Home") go(0);
    else if (key === "End") go(rows.length - 1);
    else if (key === "x") toggle(path);
    else if (key === "t") setOpen({ path, what: "tag" });
    else if (key === "b") setOpen({ path, what: "board" });
    else if (key === "m") useShell.getState().setMoving(path);
    else if (key === "p") void convert(path, "page").then(thenNext);
    else if (key === "d") void trash(path).then(thenNext);
    else return;
    event.preventDefault();
  };

  if (cards.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-line bg-canvas px-4 py-12 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-panel text-muted" aria-hidden="true">
          <Icon name="sparkle" className="size-6" />
        </span>
        <p className="mt-2 text-14 text-muted">Nothing waiting. Enjoy the quiet.</p>
      </div>
    );
  }
  const shown = cards.slice(0, limit);
  return (
    <div ref={list} className="group/list mt-8 flex flex-col gap-6" onKeyDown={onKeyDown}>
      {live.length > 0 && <PickedBar picked={live} onClear={clear} />}
      {byDay(shown).map((day) => (
        <section key={day.label} aria-label={day.label}>
          <h2 className="mb-1.5 px-1 text-12 font-medium tracking-[0.06em] text-muted">{day.label}</h2>
          <ul className="divide-y divide-line overflow-visible rounded-xl border border-line bg-canvas shadow-card">
            {day.cards.map((card) => (
              <CaptureRow key={card.path} card={card} open={open} setOpen={setOpen} picked={live.includes(card.path)} picking={live.length > 0} onPick={() => toggle(card.path)} carries={live.includes(card.path) ? live : [card.path]} />
            ))}
          </ul>
        </section>
      ))}
      <p className="-mt-3 hidden text-center text-12 text-muted group-focus-within/list:block" aria-hidden="true">
        ↑ ↓ move · X pick · T tag · B board · M move · P page · D done
      </p>
      {cards.length > limit && (
        <button type="button" className="self-center text-13 text-accent hover:underline" onClick={() => setLimit((n) => n + 200)}>
          Show {Math.min(200, cards.length - limit)} more of {cards.length.toLocaleString()}
        </button>
      )}
    </div>
  );
}

interface RowProps {
  card: NoteMeta;
  open: Open;
  setOpen: (open: Open) => void;
  picked: boolean;
  /** Whether any card is picked: then every row shows its box. */
  picking: boolean;
  onPick(): void;
  /** What a drag from this row carries: every picked card, if it is one. */
  carries: readonly string[];
}

function CaptureRow({ card, open, setOpen, picked, picking, onPick, carries }: RowProps) {
  const { openPath, trash, convert } = useWorkspace.getState();
  const active = open?.path === card.path;
  const title = titleOf(card);
  const long = card.words >= LONG_WORDS;
  // Put off to a later day: triage leaves it out until then.
  const until = deferredUntil(card);
  const putOff = until !== null && until > dayFrom(0) ? until : null;
  // The icon gives way to a box to pick the card, on hover or while picking.
  const box = picking ? "" : "hidden group-focus-within:block group-hover:block";
  return (
    <li draggable onDragStart={(e) => dragNotes(e, carries)} className={`group relative flex items-start gap-3 px-4 ${card.excerpt ? "py-3" : "py-2.5"} ${active ? "bg-hover" : picked ? "bg-soft" : "hover:bg-hover/60"}`}>
      <span className="grid h-[22px] w-5 shrink-0 place-items-center text-16">
        <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Pick ${title}`} className={`size-4 accent-[var(--color-accent)] ${box}`} />
        {!picking && (
          <span aria-hidden="true" className="group-focus-within:hidden group-hover:hidden">
            <IconOrEmoji icon={iconOf(card)} />
          </span>
        )}
      </span>
      <button type="button" data-capture={card.path} aria-keyshortcuts="X T B M P D" className="min-w-0 flex-1 rounded-sm text-left" onClick={(e) => openPath(card.path, howFrom(e))} {...openMenuHandlers(card.path)}>
        <span className="block text-14 font-medium leading-[22px] [overflow-wrap:anywhere]">{title}</span>
        {card.excerpt && <span className="mt-0.5 line-clamp-2 block text-13 leading-[20px] text-muted">{card.excerpt}</span>}
        {(long || card.tags.length > 0 || putOff) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-12 text-muted">
            {putOff && (
              <span className="inline-flex items-center gap-1" title="Put off: triage brings it back that day">
                <Icon name="clock" className="size-3" />
                Back on {shortDay(putOff)}
              </span>
            )}
            {long && (
              <span className="inline-flex items-center gap-1">
                <Icon name="page" className="size-3" />
                {card.words.toLocaleString()} words
              </span>
            )}
            {card.tags.map((tag) => (
              <span key={tag} className="rounded bg-soft px-1.5 text-accent">
                #{tag}
              </span>
            ))}
          </span>
        )}
      </button>
      <span className={`shrink-0 pr-1 text-12 leading-[22px] text-muted tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 ${active ? "opacity-0" : ""}`}>{time(card)}</span>
      <span className={`${TOOLS} ${active ? SHOWN : ON_HOVER}`}>
        <TagAction compact path={card.path} open={active && open?.what === "tag"} onOpen={() => setOpen({ path: card.path, what: "tag" })} onClose={() => setOpen(null)} />
        <BoardAction compact path={card.path} open={active && open?.what === "board"} onOpen={() => setOpen({ path: card.path, what: "board" })} onClose={() => setOpen(null)} />
        <button type="button" aria-label={`Move ${title} to a project`} title="Move to a project or Pages" className={TOOL} onClick={() => useShell.getState().setMoving(card.path)}>
          <Icon name="move-to" className="size-4" />
        </button>
        <button type="button" aria-label={`Make ${title} a page`} title="Make it a page, in Pages" className={TOOL} onClick={() => void convert(card.path, "page")}>
          <Icon name="page" className="size-4" />
        </button>
        <button type="button" aria-label={`Move ${title} to the trash`} title="Done: move to the trash" className={TOOL} onClick={() => void trash(card.path)}>
          <Icon name="check" className="size-4" />
        </button>
      </span>
    </li>
  );
}
