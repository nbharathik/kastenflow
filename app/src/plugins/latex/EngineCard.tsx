// What the preview shows when there is nothing to build with: one plain
// sentence and the next steps as buttons. Install Tectonic (a download the
// app manages, with its progress here), or use the TeX installation already on
// this computer. When the download finishes the document builds by itself.

import { useEffect, useRef } from "react";

import { Button } from "../../ui/Button";
import { usePlugins } from "../registry";
import { megabytes } from "../status";
import type { Session } from "./session";
import type { BuildError } from "./types";

const RUNNING = ["downloading", "verifying", "installing"];

export function EngineCard({ error, session }: { error: BuildError; session: Session }) {
  const info = usePlugins((s) => s.info.find((p) => p.id === "latex"));
  const payload = usePlugins((s) => s.payload.latex);
  const installed = payload?.installed === true;
  const was = useRef(installed);
  useEffect(() => {
    // The download just finished: build.
    if (installed && !was.current) void session.buildNow();
    was.current = installed;
  }, [installed, session]);

  const phase = payload?.phase ?? "idle";
  const running = RUNNING.includes(phase);
  const percent = payload && payload.total > 0 ? Math.min(100, Math.floor((payload.done / payload.total) * 100)) : null;
  const canDownload = info?.payload != null;
  const label = phase === "failed" ? "Try the download again" : canDownload ? `Install Tectonic (${megabytes(info.payload!.sizeBytes)})` : "Install Tectonic";

  return (
    <div className="latex-engine" role="group" aria-label="No TeX engine">
      <h3>This document needs a TeX engine</h3>
      <p className="m-0 text-13 text-muted">{error.message}</p>
      {phase === "failed" && payload?.error && (
        <p role="alert" className="mt-2 text-13 text-danger">
          {payload.error}
        </p>
      )}
      {running ? (
        <div className="mt-3 flex items-center gap-3 text-13">
          <span className="latex-meter" role="progressbar" aria-label="Downloading Tectonic" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <span className={percent === null ? "is-unknown" : undefined} style={{ width: `${percent ?? 100}%` }} />
          </span>
          <span>{phase === "verifying" ? "Checking the download" : phase === "installing" ? "Installing" : percent === null ? "Downloading" : `Downloading ${percent} %`}</span>
          <Button size="sm" tone="quiet" onClick={() => void usePlugins.getState().cancel("latex")}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="latex-actions">
          {canDownload ? (
            <Button tone="primary" icon="download" onClick={() => void usePlugins.getState().install("latex")}>
              {label}
            </Button>
          ) : (
            <p className="m-0 text-13 text-muted">The Tectonic download is not available in this version.</p>
          )}
          {error.next === "install-tex" ? (
            <Button onClick={() => void session.buildNow()}>Check again</Button>
          ) : (
            <Button onClick={() => void session.useEngine("latexmk-pdf")}>Use my TeX</Button>
          )}
        </div>
      )}
      {!running && error.next === "install-tex" && (
        <p className="m-0 mt-3 text-13 text-muted">
          You can get a TeX installation for free: MiKTeX (miktex.org) on Windows, MacTeX (tug.org/mactex) on a Mac, or TeX Live (tug.org/texlive) on Linux. Install it, then choose Check again.
        </p>
      )}
      <p className="mb-0 mt-3 text-12 text-faint">The first build downloads TeX packages; later builds work offline.</p>
    </div>
  );
}
