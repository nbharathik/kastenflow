import { NumberField } from "../../../ui/Fields.tsx";
import { Row, TextField, TriToggle } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { CompositeSection } from "./CompositeSection.tsx";

/** The longest a timer counts: 999 minutes. */
const MOST_MINUTES = 999;

/** A countdown: how long, the words with it, and whether it starts by itself. */
export function TimerSection({ session, ui, elements }: SectionProps) {
  const timers = only(elements, "timer");
  const total = agree<number>(timers.map((t) => t.seconds), 0);
  const label = shared(timers.map((t) => t.label ?? ""), "");
  const autostart = agree<boolean>(timers.map((t) => t.autostart === true), false);
  // Minutes and seconds are two boxes for one number; each timer keeps the part that is not being changed, and none counts down from nothing.
  const set = (make: (seconds: number) => number) => patchEach(session, timers, (t) => ({ seconds: Math.max(1, Math.round(make(t.seconds))) }));

  return (
    <CompositeSection id="timer" title="Timer" ui={ui} ids={timers.map((t) => t.id)}>
      <Row label="Counts down from">
        <span className="ks-sp-plain" data-primary="">
          <NumberField label="Minutes" unit="min" min={0} max={MOST_MINUTES} decimals={0} width={64} value={total === "mixed" ? "mixed" : Math.floor(total / 60)} onCommit={(n) => set((s) => n * 60 + (s % 60))} />
        </span>
        <span className="ks-sp-plain">
          <NumberField label="Seconds" unit="s" min={0} max={59} decimals={0} width={56} value={total === "mixed" ? "mixed" : total % 60} onCommit={(n) => set((s) => Math.floor(s / 60) * 60 + n)} />
        </span>
      </Row>
      <Row label="Words" wide>
        <TextField label="Timer words" value={label.value} mixed={label.mixed} placeholder="Time left" onCommit={(text) => patchEach(session, timers, () => ({ label: text.trim() === "" ? null : text }))} />
      </Row>
      <TriToggle label="Start by itself when the slide shows" on={autostart} onChange={(on) => patchEach(session, timers, () => ({ autostart: on }))} />
      <p className="ks-sp-hint">It counts down while presenting. Without the box ticked, a click starts it.</p>
    </CompositeSection>
  );
}
