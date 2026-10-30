// What's new: the release a check found, its notes, and the way to get it.
// A build that installs in place offers "Install and restart", which waits
// for the person; any other offers the installer to download in the
// browser. Either way the dialog says the notes stay where they are.

import "../workspace/overlays/overlays.css";
import "./updates.css";

import { openUrl } from "../../lib/api";
import { said } from "../../lib/said";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Markdown } from "../chat/markdown/Markdown";
import { installAndRestart, installLabel } from "./install";
import { useUpdates } from "./store";

/** A size in bytes as people read it. */
export function sizeText(bytes: number): string {
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** A release date, such as "1 Oct 2026". */
function dateText(iso: string | null): string | null {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Release notes have no pages of this vault to open.
const noTitles = () => {};

export default function WhatsNew({ open = openUrl, install = installAndRestart }: { open?: (url: string) => Promise<void>; install?: () => Promise<void> }) {
  const info = useUpdates((s) => s.info);
  const hide = useUpdates((s) => s.hide);
  const skip = useUpdates((s) => s.skip);
  const canInstall = useUpdates((s) => s.canInstall);
  const phase = useUpdates((s) => s.phase);
  const progress = useUpdates((s) => s.progress);
  const installError = useUpdates((s) => s.installError);
  if (!info?.newer) return null;
  const released = dateText(info.published);
  const go = (url: string) => void open(url).catch(said("Could not open the link"));
  const busy = phase === "downloading" || phase === "installing";
  // In place first; after a failure, the installer in the browser.
  const inPlace = canInstall && phase !== "failed";

  return (
    <Modal plain labelledBy="kasten-whatsnew-title" onClose={hide} className="kasten-whatsnew">
      <header className="kasten-whatsnew-head">
        <span className="kasten-whatsnew-badge">
          <Icon name="sparkle" className="size-3.5" />
          New version
        </span>
        <h2 id="kasten-whatsnew-title">{info.name.includes(info.latest) ? info.name : `KastenFlow ${info.latest}`}</h2>
        <p>
          You have {info.current}
          {released && ` · Released ${released}`}
        </p>
        <button type="button" className="kasten-whatsnew-close" aria-label="Close" onClick={hide}>
          <Icon name="close" className="size-4" />
        </button>
      </header>
      <div className="kasten-whatsnew-notes">
        {info.notes.trim() ? <Markdown text={info.notes} onOpenTitle={noTitles} /> : <p className="kasten-whatsnew-empty">The release page lists what changed.</p>}
      </div>
      <footer className="kasten-whatsnew-foot">
        {installError && phase === "failed" ? (
          <p className="kasten-whatsnew-problem" role="alert">
            <Icon name="alert" className="size-3.5" />
            {installError}
          </p>
        ) : (
          <p className="kasten-whatsnew-safe">
            <Icon name="check" className="size-3.5" />
            {canInstall
              ? "Your notes stay in their folder. What you typed is saved first, then KastenFlow installs and opens again."
              : "Your notes stay in their folder. Installing replaces only the app."}
          </p>
        )}
        <div className="kasten-whatsnew-actions">
          <button type="button" className="is-quiet" onClick={skip} disabled={busy}>
            Skip this version
          </button>
          <button type="button" onClick={hide}>
            Later
          </button>
          <button type="button" className={info.download || inPlace ? undefined : "is-primary"} onClick={() => go(info.url)}>
            Release page
          </button>
          {inPlace ? (
            <button type="button" className="is-primary" disabled={busy} onClick={() => void install()}>
              <Icon name="download" className="size-4" />
              {installLabel(phase, progress)}
            </button>
          ) : (
            info.download && (
              <button type="button" className="is-primary" onClick={() => go(info.download!.url)} title={info.download.name}>
                <Icon name="download" className="size-4" />
                Download{info.download.size > 0 && ` (${sizeText(info.download.size)})`}
              </button>
            )
          )}
        </div>
      </footer>
    </Modal>
  );
}
