// The History tab: this note's versions as a timeline with a slider to scrub
// through them, and the chosen one's text, its changes and "Restore this
// version".

import "./history.css";

import { useEffect, useRef, useState } from "react";

import { relativeTime } from "../../../lib/dates";
import type { CommitInfo, NoteMeta } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { describeChange } from "../../review/change-words";
import { useVaultStatus } from "../../workspace/status";
import { openSettingsAt } from "../../workspace/views/settings/jump";
import { errorText, type PanelPage } from "../page-edit";
import { authorOf } from "./versions";
import { VersionView } from "./VersionView";

const LIMIT = 50;

export function HistoryTab({ note, body, page }: { note: NoteMeta; body: string; page: PanelPage }) {
  const { client } = page;
  // Commits made by the clock change the vault status; fetch again then.
  const status = useVaultStatus((s) => s.status);
  const [versions, setVersions] = useState<CommitInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const texts = useRef(new Map<string, string | null>());
  const loaded = versions !== null;

  useEffect(() => {
    let live = true;
    // At once when the tab opens; after a pause while the page is being edited.
    const timer = setTimeout(
      () => {
        client.history(note.path, LIMIT).then(
          (found) => {
            if (!live) return;
            setVersions(found);
            setError(null);
          },
          (err: unknown) => live && setError(errorText(err)),
        );
      },
      loaded ? 1000 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `loaded` only picks the delay; it is no reason to fetch again.
  }, [client, note.path, note.modified, status]);

  const index = versions ? Math.max(0, versions.findIndex((v) => v.id === picked)) : 0;
  const selected = useRef<HTMLLIElement | null>(null);
  // A block body: newer engines return a Promise from scrollIntoView, and
  // an effect may return only its cleanup.
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (error) return <p className="kasten-panel-empty">The history could not be read: {error}</p>;
  if (!versions) return <p className="kasten-panel-empty">Reading the history…</p>;
  if (versions.length === 0) {
    const off = status !== null && !status.history;
    return (
      <div className="kasten-history-empty">
        <Icon name="history" className="size-6" />
        <p>{off ? "History is off, so earlier versions are not kept." : "No versions yet. Each saved change to this page is kept as a version you can go back to."}</p>
        {off && (
          <button type="button" className="kasten-panel-button" onClick={() => openSettingsAt({ group: "history", row: "history.history" })}>
            Turn it on in Settings
          </button>
        )}
      </div>
    );
  }

  const version = versions[index]!;
  const last = versions.length - 1;
  return (
    <div className="kasten-history">
      {versions.length > 1 && (
        <div className="kasten-scrub">
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={last - index}
            aria-label="Scrub through versions"
            aria-valuetext={`${relativeTime(version.time)}, ${version.summary}`}
            onChange={(e) => setPicked(versions[last - Number(e.target.value)]!.id)}
          />
          <div className="kasten-scrub-ends" aria-hidden="true">
            <span>Oldest</span>
            <span>
              {versions.length - index} of {versions.length}
            </span>
            <span>Newest</span>
          </div>
        </div>
      )}
      <ol className="kasten-timeline" aria-label="Versions">
        {versions.map((v, i) => (
          <li key={v.id} ref={i === index ? selected : undefined} className={i === index ? "is-selected" : undefined}>
            <button type="button" aria-current={i === index ? "true" : undefined} onClick={() => setPicked(v.id)}>
              <span className="kasten-version-line">
                <span className="kasten-version-when" title={new Date(v.time).toLocaleString()}>
                  {relativeTime(v.time)}
                </span>
                {v.agent && <span className="kasten-agent-badge">Agent</span>}
                <span className="kasten-version-who">{authorOf(v)}</span>
              </span>
              <span className="kasten-version-what" title={v.message}>
                <VersionWords summary={v.summary} />
                {v.approvedBy && ` · approved by ${v.approvedBy}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <VersionView
        key={version.id}
        version={version}
        path={note.path}
        current={body}
        texts={texts.current}
        showChanges={showChanges}
        onShowChanges={setShowChanges}
        page={page}
      />
    </div>
  );
}

/** What a version did to this page, without the page's own title. */
function VersionWords({ summary }: { summary: string }) {
  const change = describeChange(summary);
  if (!change.action) return summary;
  return change.detail ? `${change.action} ${change.detail}` : change.action;
}
