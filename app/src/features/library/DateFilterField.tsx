import { useState } from "react";

import { DATE_PRESETS, dateFilterLabel, monthFilter, rangeEnds, rangeFilter, type DateFilter } from "./date-filter";
import { Dropdown } from "./Dropdown";

const field = "h-7 min-w-0 rounded-md border border-line bg-raised px-1.5 text-12 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** "Created" or "Updated": a preset (today, this or last week, this or last
 * month) from the list, or a chosen month or a custom range under it. */
export function DateFilterField({ label, value, onChange }: { label: "Created" | "Updated"; value: DateFilter; onChange(value: DateFilter): void }) {
  const custom = value.startsWith("month:") || value.startsWith("range:");
  const display = value === "any" ? `${label} any time` : custom ? `${label}: ${dateFilterLabel(value)}` : `${label} ${dateFilterLabel(value).toLowerCase()}`;
  return (
    <Dropdown
      label={label}
      value={value}
      display={display}
      active={value !== "any"}
      options={DATE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
      onChange={(v) => onChange(v as DateFilter)}
      footer={() => <CustomDates label={label} value={value} onChange={onChange} />}
    />
  );
}

/** A month to pick, or the two days of a range: each applies as soon as it reads. */
function CustomDates({ label, value, onChange }: { label: string; value: DateFilter; onChange(value: DateFilter): void }) {
  const [start, end] = rangeEnds(value);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const range = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    // Half typed or backwards, it waits; both ends cleared lifts the filter.
    const next = rangeFilter(nextFrom, nextTo);
    if (next !== "any" || (!nextFrom && !nextTo)) onChange(next);
  };
  return (
    <div className="space-y-2 border-t border-line p-3 text-12 text-muted">
      <label className="flex items-center justify-between gap-2">
        A month
        <input type="month" aria-label={`${label}: a month`} value={value.startsWith("month:") ? value.slice(6) : ""} onChange={(event) => onChange(monthFilter(event.target.value))} className={field} />
      </label>
      <div role="group" aria-label={`${label}: a range`} className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
        <label htmlFor={`${label}-from`}>From</label>
        <input id={`${label}-from`} type="date" value={from} onChange={(event) => range(event.target.value, to)} className={field} />
        <label htmlFor={`${label}-to`}>To</label>
        <input id={`${label}-to`} type="date" value={to} onChange={(event) => range(from, event.target.value)} className={field} />
      </div>
    </div>
  );
}
