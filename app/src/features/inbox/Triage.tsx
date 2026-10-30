import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dayFrom, shortDay } from "../../lib/dates";
import { freeKey, inFocusedPane } from "../../lib/keys";
import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { useWorkspace } from "../workspace/store";
import { ActionBar, type Picking } from "./ActionBar";
import { caughtThisWeek, deferredFrom, deferredUntil, laterDay, nextReading, readingOf } from "./queue";
import { useSuggestedHome } from "./suggest";
import { SuggestedHome } from "./SuggestedHome";
import { TriageCard } from "./TriageCard";
import { TriageContext } from "./TriageContext";
import { archiveCard, deferCard, makeTask, setReading } from "./triage-actions";
import { HELP, actOf, helpText, type TriageAct } from "./triage-keys";

/** Triage: the cards waiting to be dealt with, one at a time, with the list
 * around it in view. Every action has a key (the help line under the buttons
 * lists them) so a batch goes through without a menu, and every one says what
 * it did in a notice whose Undo takes it back; U presses the newest Undo.
 * What leaves the queue (filed, put off, archived, moved, made a page, done)
 * lets the next card slide in; tagging, boards, collections, tasks and
 * reading states leave the card in front of you. */
export function Triage({ cards, onExit }: { cards: NoteMeta[]; onExit: () => void }) {
  const today = dayFrom(0);
  const [weekOnly, setWeekOnly] = useState(false);
  const [at, setAt] = useState(0);
  const [picking, setPicking] = useState<Picking | null>(null);
  const root = useRef<HTMLElement>(null);
  const moving = useShell((s) => s.moving);
  const notes = useWorkspace((s) => s.notes);
  const thisWeek = useMemo(() => caughtThisWeek(cards, today), [cards, today]);
  const shown = weekOnly ? thisWeek : cards;
  const index = Math.min(at, shown.length - 1);
  const card = shown[index];
  const home = useSuggestedHome(card);
  const goHome = useCallback(() => {
    if (card && home?.project) void useWorkspace.getState().move(card.path, home.project.folder);
  }, [card, home]);

  useBringBack(cards, (path) => {
    const back = shown.findIndex((c) => c.path === path);
    if (back >= 0) setAt(back);
  });

  const perform = useCallback(
    (act: TriageAct) => {
      const workspace = useWorkspace.getState();
      if (act === "stop") return onExit();
      if (act === "this-week") {
        setWeekOnly((on) => !on);
        return setAt(0);
      }
      if (act === "undo") return pressUndo();
      if (!card) return;
      switch (act) {
        case "next":
          return setAt(Math.min(index + 1, shown.length - 1));
        case "prev":
          return setAt(Math.max(index - 1, 0));
        case "move":
          return useShell.getState().setMoving(card.path);
        case "tag":
        case "board":
        case "collection":
        case "later":
          return setPicking(act);
        case "task":
          return void makeTask(card);
        case "archive":
          return void archiveCard(card);
        case "tomorrow":
        case "week":
        case "month":
          return void deferCard(card, laterDay(act, today));
        case "reading":
          return void setReading(card, nextReading(readingOf(card)));
        case "page":
          return void workspace.convert(card.path, "page");
        case "done":
          return void workspace.trash(card.path);
        case "home":
          return goHome();
        case "open":
          return workspace.openPath(card.path, "here");
        case "stack":
          return workspace.openPath(card.path, "stack");
      }
    },
    [card, index, shown.length, today, onExit, goHome],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (moving || picking || event.ctrlKey || event.metaKey || event.altKey) return;
      // Keys for a field, or for another pane, are not triage's.
      if (!freeKey(event) || !inFocusedPane(root.current)) return;
      const act = actOf(event);
      if (!act || (!card && act !== "stop" && act !== "this-week")) return;
      // Enter on a button presses that button; it does not open the card.
      if (event.key === "Enter" && (event.target as HTMLElement | null)?.closest?.("button, a, [role='button']")) return;
      if (act === "home" && !home?.project) return;
      perform(act);
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, home, moving, picking, perform]);

  if (!card) return <Empty cards={cards.length} weekOnly={weekOnly} onAll={() => setWeekOnly(false)} onExit={onExit} later={deferredFrom(notes, today)} />;

  return (
    <section ref={root} aria-label="Triage" className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-13 font-medium text-muted" aria-live="polite">
          {index + 1} of {shown.length}
        </p>
        <div className="h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full origin-left rounded-full bg-accent transition-transform duration-(--motion-slow)" style={{ transform: `scaleX(${(index + 1) / shown.length})` }} />
        </div>
        <Segmented
          label="Which captures"
          value={weekOnly ? "week" : "all"}
          onChange={(value) => {
            setWeekOnly(value === "week");
            setAt(0);
          }}
          choices={[
            { value: "all", label: `All ${cards.length}` },
            { value: "week", label: `This week ${thisWeek.length}` },
          ]}
        />
      </div>
      <TriageCard card={card} />
      {home && <SuggestedHome home={home} path={card.path} onMove={goHome} />}
      <ActionBar card={card} picking={picking} setPicking={setPicking} run={perform} />
      <p className="mt-3 text-12 leading-relaxed text-muted" title={helpText()}>
        {HELP.map(([keys, what], i) => (
          <span key={keys}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            <kbd className="rounded bg-line/70 px-1 font-sans text-11">{keys}</kbd> {what}
          </span>
        ))}
      </p>
      <TriageContext cards={shown} index={index} onPick={setAt} />
    </section>
  );
}

/** Presses the Undo of the newest notice that has one. */
function pressUndo(): void {
  const { toasts, dismiss, toast } = useWorkspace.getState();
  const last = [...toasts].reverse().find((t) => t.action?.label === "Undo");
  if (!last) return toast("Nothing to undo");
  dismiss(last.id);
  last.action!.run();
}

/** After Undo puts a card back in the queue, shows it: a card that left the
 * queue while triage was open and is in it again. */
function useBringBack(queue: readonly NoteMeta[], show: (path: string) => void): void {
  const before = useRef<string[]>([]);
  const left = useRef(new Set<string>());
  const latest = useRef(show);
  useEffect(() => {
    latest.current = show;
  });
  useEffect(() => {
    const now = new Set(queue.map((c) => c.path));
    for (const path of before.current) if (!now.has(path)) left.current.add(path);
    const back = queue.find((c) => left.current.has(c.path) && !before.current.includes(c.path));
    if (back) {
      left.current.delete(back.path);
      latest.current(back.path);
    }
    before.current = queue.map((c) => c.path);
  }, [queue]);
}

function Empty({ cards, weekOnly, onAll, onExit, later }: { cards: number; weekOnly: boolean; onAll(): void; onExit(): void; later: NoteMeta[] }) {
  const quiet = cards === 0 || !weekOnly;
  const first = later[0] ? deferredUntil(later[0]) : null;
  return (
    <div className="mt-8 rounded-2xl border border-line bg-canvas p-12 text-center shadow-card">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-panel text-muted" aria-hidden="true">
        <Icon name="party" className="size-6" />
      </span>
      <p className="mt-2 text-16 font-semibold">{quiet ? "Inbox zero" : "Nothing caught this week"}</p>
      <p className="mt-1 text-13 text-muted">
        {quiet ? "Everything has a place." : "No capture from the last seven days is waiting."}
        {first && quiet ? ` ${later.length} put off until later; the first comes back on ${shortDay(first)}.` : ""}
      </p>
      <p className="mt-4 flex justify-center gap-4 text-13">
        {!quiet && (
          <button type="button" className="font-medium text-accent hover:underline" onClick={onAll}>
            Show every capture
          </button>
        )}
        <button type="button" className="font-medium text-accent hover:underline" onClick={onExit}>
          Back to the list
        </button>
      </p>
    </div>
  );
}
