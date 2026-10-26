// The timeline of a tag database: notes as bars (a start and an end date) or
// markers (a start only) along a scale of days, in lanes by a select
// property, with today's line, today centred when it opens, and the notes
// without dates listed beside it. Dragging a bar or its edge, or Alt+←/→ on
// it, changes its dates in one change with an Undo (the calendar's moves,
// calendar/use-moves.ts). Plain CSS, no library.

import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { dayFrom, daysBetween } from "../../../../lib/dates";
import { scrollMotion } from "../../../../lib/motion";
import type { TagView } from "../../../../lib/vault/types";
import { useMoves } from "../../../calendar/use-moves";
import { howFromView } from "../../../workspace/store-layout";
import { useWorkspace } from "../../../workspace/store";
import { Dropdown } from "../../../library/Dropdown";
import { useFrontActions } from "../../in-front";
import { Bar } from "./Bar";
import { Header, Lines } from "./Header";
import { daysOf, laneDef, lanesOf, newDatesTarget, readItems, targetOf, withPending, type Item, type Keys } from "./items";
import { actionOf, neighbour, type Rows } from "./keys";
import { DAY_WIDTH, SCALES, SCALE_LABELS, boxOf, carry, packRows, scaleOf, viewSpan, widthOf, xOf, type Grip, type Scale } from "./layout";
import { NoDates } from "./NoDates";
import { useBarDrag } from "./use-bar-drag";
import type { ViewProps } from "../types";

/** Width of the lane labels, row height and room above and below a lane's rows. */
export const LABEL_W = 168;
const ROW_H = 30;
const LANE_PAD = 6;

/** The room a marker's title takes beside it, estimated from its length. */
const labelRoom = (title: string) => Math.min(180, title.length * 7) + 18;

interface TimelineProps extends Pick<ViewProps, "tag" | "schema" | "notes" | "onChange"> {
  view: TagView;
  keys: Keys;
}

export function Timeline({ tag, view, schema, notes, keys, onChange }: TimelineProps) {
  const today = dayFrom(0);
  const scale = scaleOf(view.scale);
  const scroller = useRef<HTMLDivElement>(null);
  const moves = useMoves();
  const hint = useId();
  const [active, setActive] = useState<string | null>(null);
  const follow = useRef<string | null>(null);
  const touched = useRef(false);

  const { dated, undated } = useMemo(() => readItems(notes, keys), [notes, keys]);
  const shown = useMemo(() => withPending(dated, moves.pending), [dated, moves.pending]);
  const def = laneDef(view, schema);
  const lanes = useMemo(() => lanesOf(shown, def), [shown, def]);

  // The days the grid covers change only when the first or last date does.
  const first = shown.reduce((a, i) => (i.dates!.start < a ? i.dates!.start : i.dates!.end !== null && i.dates!.end < a ? i.dates!.end : a), today);
  const last = shown.reduce((a, i) => (i.dates!.start > a ? i.dates!.start : i.dates!.end !== null && i.dates!.end > a ? i.dates!.end : a), today);
  const span = useMemo(() => viewSpan([first, last], today, scale), [first, last, today, scale]);
  const width = widthOf(span, scale);

  // Each lane's bars in rows, and all the rows in order for the arrow keys.
  const placed = useMemo(
    () =>
      lanes.map((lane) => {
        const boxes = lane.items.map((item) => {
          const dates = item.dates!;
          const box = boxOf(dates.start, dates.end, span.from, scale);
          const point = dates.end === null || dates.end < dates.start;
          return { item, left: box.left, right: box.left + (point ? DAY_WIDTH[scale] + labelRoom(item.title) : box.width) };
        });
        const { rows, count } = packRows(boxes.map((b) => ({ id: b.item.id, left: b.left, right: b.right })));
        return { lane, count, bars: boxes.map((b) => ({ item: b.item, row: rows.get(b.item.id)! })) };
      }),
    [lanes, span.from, scale],
  );
  const rows: Rows = useMemo(
    () =>
      placed.flatMap((p) =>
        Array.from({ length: p.count }, (_, r) =>
          p.bars
            .filter((b) => b.row === r)
            .map((b) => {
              const box = boxOf(b.item.dates!.start, b.item.dates!.end, span.from, scale);
              return { id: b.item.id, centre: box.left + box.width / 2 };
            })
            .sort((a, b) => a.centre - b.centre),
        ),
      ),
    [placed, span.from, scale],
  );
  const activeId = active && shown.some((i) => i.id === active) ? active : (rows.find((r) => r.length > 0)?.[0]?.id ?? null);

  // Handlers read the latest state from here, so the bars are not redrawn for nothing.
  const latest = useRef({ shown, keys, rows, move: moves.move });
  useLayoutEffect(() => {
    latest.current = { shown, keys, rows, move: moves.move };
  });

  const centre = useCallback(
    (calm: boolean) => {
      const el = scroller.current;
      if (!el) return;
      const left = Math.max(0, xOf(today, span.from, scale) + DAY_WIDTH[scale] / 2 - (el.clientWidth - (def ? LABEL_W : 0)) / 2);
      // Opening and changing the scale jump there; the Today button glides unless motion is off.
      if (!calm && scrollMotion() === "smooth" && typeof el.scrollTo === "function") el.scrollTo({ left, behavior: "smooth" });
      else el.scrollLeft = left;
    },
    [def, scale, span.from, today],
  );
  // Opening, and changing the scale, centre today; a grid that grows to the left keeps what is in view.
  const origin = useRef<{ from: string; scale: Scale } | null>(null);
  useLayoutEffect(() => {
    const was = origin.current;
    origin.current = { from: span.from, scale };
    const el = scroller.current;
    if (!was || was.scale !== scale || !touched.current) {
      if (was?.scale !== scale) touched.current = false;
      centre(true);
    } else if (el && was.from !== span.from) {
      el.scrollLeft += daysBetween(span.from, was.from) * DAY_WIDTH[scale];
    }
  }, [span.from, scale, centre]);

  // A bar moved by key may leave the screen: it is brought back into view.
  useLayoutEffect(() => {
    const id = follow.current;
    if (!id) return;
    follow.current = null;
    barElement(scroller.current, id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  const drag = useBarDrag(scroller, scale, (id, grip, delta) => change(id, grip, delta, false));

  function change(id: string, grip: Grip, delta: number, later: boolean) {
    const { shown: items, keys: used, move } = latest.current;
    const item = items.find((i) => i.id === id);
    if (!item?.dates || item.locked) return;
    const next = carry(item.dates, grip, delta);
    if (next.start === item.dates.start && next.end === item.dates.end) return;
    const target = targetOf(item, used);
    move(target, daysOf(next, target), later);
    if (later) follow.current = id;
  }

  const open = useCallback((event: MouseEvent<HTMLElement>, id: string) => {
    useWorkspace.getState().openPath(id, howFromView(event));
  }, []);
  const onKey = useCallback((event: KeyboardEvent<HTMLElement>, id: string) => {
    const action = actionOf(event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "open") return void useWorkspace.getState().openPath(id, "peek");
    if (action.kind === "shift") return change(id, action.grip, action.days, true);
    const next = neighbour(latest.current.rows, id, action.step);
    if (next && next !== id) {
      setActive(next);
      barElement(scroller.current, next)?.focus();
    }
  }, []);
  const setDates = useCallback((item: Item) => {
    const { target, days } = newDatesTarget(item, latest.current.keys, dayFrom(0));
    latest.current.move(target, days);
  }, []);

  const saveScale = (next: string) => {
    const kept: TagView = { ...view, start: keys.start, scale: next as Scale };
    if (keys.end) kept.end = keys.end;
    onChange(kept);
  };
  const nothing = shown.length === 0;
  // The palette's way to Today and the scale (see tags/commands.ts).
  useFrontActions("timeline", scroller, { today: () => centre(false), setScale: saveScale });

  return (
    <div className="kasten-tl" data-scale={scale}>
      <div className="kasten-tl-tools">
        <Dropdown label="Scale" value={scale} options={SCALES.map((s) => ({ value: s, label: SCALE_LABELS[s] }))} onChange={saveScale} />
        <button type="button" className="kasten-tagdb-button" onClick={() => centre(false)}>
          Today
        </button>
        <span className="kasten-tl-tip">Drag a bar to move it, an end to resize it. Alt+← or Alt+→ shifts it a day.</span>
      </div>
      <span id={hint} className="sr-only">
        Arrow keys move between bars. Alt with left or right arrow shifts the dates by a day, and with Shift moves the end. Enter opens the note.
      </span>
      {nothing && (
        <p className="kasten-tl-empty" role="note">
          {undated.length > 0
            ? `None of these notes has a “${keys.start}” date yet. Use Set dates beside them, then drag to adjust.`
            : `No notes yet. Add one with + New, and give it a “${keys.start}” date to see it here.`}
        </p>
      )}
      <div className="kasten-tl-body">
        <div
          ref={scroller}
          className="kasten-tl-scroll"
          role="group"
          aria-label={`Timeline of notes tagged #${tag}`}
          // Once the person has scrolled or used the grid, it keeps its place when dates change.
          onWheel={() => (touched.current = true)}
          onPointerDown={() => (touched.current = true)}
          onKeyDownCapture={() => (touched.current = true)}
        >
          <div className="kasten-tl-grid" style={{ gridTemplateColumns: `${def ? LABEL_W : 0}px ${width}px` }}>
            <Lines span={span} scale={scale} today={today} left={def ? LABEL_W : 0} />
            <div className="kasten-tl-corner" />
            <Header span={span} scale={scale} />
            {placed.map(({ lane, count, bars }) => (
              <div key={lane.key} className="kasten-tl-lane" role="presentation">
                {def && (
                  <div className="kasten-tl-label" title={lane.label}>
                    <span>{lane.label}</span>
                    <span className="kasten-tl-count">{lane.items.length}</span>
                  </div>
                )}
                <div className="kasten-tl-track" role="group" aria-label={lane.label || "Notes"} style={{ height: count * ROW_H + LANE_PAD * 2 }}>
                  {bars.map(({ item, row }) => (
                    <Bar
                      key={item.id}
                      item={item}
                      from={span.from}
                      scale={scale}
                      top={LANE_PAD + row * ROW_H}
                      today={today}
                      active={item.id === activeId}
                      preview={drag.preview?.id === item.id ? drag.preview : null}
                      hint={hint}
                      onPress={drag.press}
                      onOpen={open}
                      onKey={onKey}
                      onFocusBar={setActive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {undated.length > 0 && <NoDates items={undated} canSet={!keys.startLocked} startKey={keys.start} onSet={setDates} onOpen={open} />}
      </div>
    </div>
  );
}

function barElement(root: HTMLElement | null, id: string): HTMLElement | undefined {
  return [...(root?.querySelectorAll<HTMLElement>("[data-bar]") ?? [])].find((el) => el.dataset.bar === id);
}
