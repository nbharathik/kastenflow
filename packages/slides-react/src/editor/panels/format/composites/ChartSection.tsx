import type { ChartKind } from "@kasten-slides/wasm";

import type { Patch } from "../../../session/elements.ts";
import { Row, SelectField, TextField, TriToggle } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, json, only, same, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { ChartGrid } from "./ChartGrid.tsx";
import { type ChartTable, fit } from "./chart-data.ts";
import { CompositeSection } from "./CompositeSection.tsx";
import { MixedList } from "./ListEditor.tsx";

const KINDS: readonly { value: ChartKind; label: string }[] = [
  { value: "bar", label: "Bars" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
];

/** A chart: its type, title and legend, and the table of numbers it is drawn from. */
export function ChartSection({ session, ui, elements }: SectionProps) {
  const charts = only(elements, "chart");
  const tables: ChartTable[] = charts.map((c) => ({ categories: c.categories ?? [], series: c.series }));
  const alike = tables.every((t) => same(t, tables[0]));
  const kind = agree<ChartKind>(charts.map((c) => c.kind), "bar");
  const title = shared(charts.map((c) => c.title ?? ""), "");
  const labels = agree<boolean>(charts.map((c) => c.labels === true), false);
  // A legend is drawn for a pie and for more than one series unless the chart says otherwise.
  const legend = agree<boolean>(charts.map((c) => c.legend ?? (c.kind === "pie" || c.series.length > 1)), false);
  const change = (patch: Patch) => patchEach(session, charts, () => patch);

  return (
    <CompositeSection id="chart" title="Chart" ui={ui} ids={charts.map((c) => c.id)}>
      <Row label="Type">
        <SelectField label="Chart type" value={kind} options={KINDS} onPick={(picked) => change({ kind: picked })} />
      </Row>
      <Row label="Title" wide>
        <div data-primary="">
          <TextField label="Chart title" value={title.value} mixed={title.mixed} placeholder="No title" onCommit={(text) => change({ title: text.trim() === "" ? null : text })} />
        </div>
      </Row>
      <TriToggle label="Legend" on={legend} onChange={(on) => change({ legend: on })} />
      <TriToggle label="Numbers on the chart" on={labels} onChange={(on) => change({ labels: on })} />
      {alike ? (
        <>
          <ChartGrid table={fit(tables[0] ?? { categories: [], series: [] })} onChange={(table) => change({ categories: json(table.categories), series: json(table.series) })} />
          {kind === "pie" ? <p className="ks-sp-hint">A pie shows the first column only.</p> : null}
        </>
      ) : (
        <MixedList what="data" />
      )}
    </CompositeSection>
  );
}
