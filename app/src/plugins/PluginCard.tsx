import { useState } from "react";

import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { HelpTip } from "../features/workspace/views/settings/HelpTip";
import { usePlugins } from "./registry";
import { megabytes, NOTES, offLine, statusOf } from "./status";
import type { CatalogEntry, PluginScope } from "./types";

export interface CardData {
  id: string;
  name: string;
  summary: string;
  icon: IconName;
  scope: PluginScope;
  /** The download's size, when the plugin has one. */
  bytes: number | null;
}

/** One plugin in Settings → Plugins: what it adds, its status, the switch, and its download. */
export function PluginCard({ data, catalog }: { data: CardData; catalog: readonly CatalogEntry[] }) {
  const { id, name } = data;
  const on = usePlugins((s) => s.on[id] ?? s.enabled.includes(id));
  const payload = usePlugins((s) => s.payload[id]);
  const problem = usePlugins((s) => s.problem[id]);
  const [switchedOff, setSwitchedOff] = useState(false);
  const hasPayload = data.bytes !== null;
  const status = statusOf(on, hasPayload, payload);
  const store = usePlugins.getState;
  const note = NOTES[id];

  const toggle = (value: boolean) => {
    setSwitchedOff(!value);
    void store().setEnabled(id, value, catalog);
  };

  return (
    <div data-plugin={id} className="kasten-plugin">
      <div className="kasten-set-row">
        <div className="kasten-set-text">
          <div className="kasten-set-label">
            <Icon name={data.icon} className="kasten-set-icon" />
            <span className="kasten-set-name">{name}</span>
            {note && <HelpTip label={name}>{note}</HelpTip>}
          </div>
          <div className="kasten-set-detail">{data.summary}</div>
          <div className="kasten-set-detail">
            {data.scope === "computer" ? "This computer" : "This vault"}
            {data.bytes !== null && ` · ${megabytes(data.bytes)} download`}
          </div>
        </div>
        <div className="kasten-set-control">
          <span role="status" className={`kasten-plugin-status is-${status.kind}`}>
            {status.text}
          </span>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" role="switch" aria-label={name} checked={on} onChange={(e) => toggle(e.target.checked)} className="peer sr-only" />
            <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
            <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-knob shadow transition-transform peer-checked:translate-x-4 peer-checked:bg-on-accent" />
          </label>
        </div>
      </div>

      {status.kind === "downloading" && (
        <div className="kasten-plugin-more">
          <span className="kasten-plugin-track" role="progressbar" aria-label={`${name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent ?? undefined}>
            <span style={{ width: `${status.percent ?? 100}%` }} className={status.percent === null ? "is-unknown" : undefined} />
          </span>
          <span className="kasten-set-detail">{payload && payload.total > 0 ? `${megabytes(payload.done)} of ${megabytes(payload.total)}` : ""}</span>
          <Button size="sm" onClick={() => void store().cancel(id)}>
            Cancel
          </Button>
        </div>
      )}

      {status.kind === "needs" && (
        <div className="kasten-plugin-more">
          <span className="kasten-set-detail">{name} needs a one-time download before it works.</span>
          <Button size="sm" tone="primary" onClick={() => void store().install(id)}>
            Download
          </Button>
        </div>
      )}

      {status.kind === "update" && (
        <div className="kasten-plugin-more">
          <span className="kasten-set-detail">A newer version of {name} is ready to download.</span>
          <Button size="sm" tone="primary" onClick={() => void store().install(id)}>
            Update
          </Button>
        </div>
      )}

      {status.kind === "failed" && (
        <div className="kasten-plugin-more" role="alert">
          <span className="kasten-set-detail is-danger">{payload?.error || "The download did not finish."}</span>
          <Button size="sm" tone="primary" onClick={() => void store().install(id)}>
            Retry
          </Button>
        </div>
      )}

      {payload?.phase === "cancelled" && on && status.kind === "needs" && <div className="kasten-plugin-more kasten-set-detail">The download was cancelled.</div>}

      {problem && (
        <div className="kasten-plugin-more" role="alert">
          <span className="kasten-set-detail is-danger">{problem}</span>
        </div>
      )}

      {hasPayload && payload?.installed && status.kind !== "downloading" && (
        <div className="kasten-plugin-more">
          <span className="kasten-set-detail">Downloaded{on ? "" : "; kept in case you turn it back on"}.</span>
          <Button size="sm" tone="quiet" onClick={() => void store().remove(id)}>
            Remove download
          </Button>
        </div>
      )}

      {!on && switchedOff && <div className="kasten-plugin-more kasten-set-detail">{offLine(id, name)}</div>}
    </div>
  );
}
