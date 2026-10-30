import "./smart.css";
import "./author/print.css";

import { lazy, Suspense, useState } from "react";

import { inTauri } from "../../lib/api";
import { Button, IconButton } from "../../ui/Button";
import { Disclosure } from "../../ui/Disclosure";
import { tauriSmartBackend, type SmartBackend } from "./backend";
import { AllowRun } from "./AllowRun";
import type { AuthorBackend } from "./author/backend";
import { HistoryTab } from "./HistoryTab";
import { SmartFrame } from "./SmartFrame";
import { SmartTabs } from "./SmartTabs";
import { usePageInfo } from "./use-page-info";
import type { SmartSide } from "./use-smart-side";
import { useTrust } from "./use-trust";
import { NO_VIEW_LINE, PICTURES_WARNING } from "./words";

/** The code editor loads when "Edit code" is first used. */
const AuthorPane = lazy(() => import("./author/AuthorPane").then((m) => ({ default: m.AuthorPane })));

interface Props {
  pagePath: string;
  pageId: string;
  title: string;
  /** "smart" (the page's view) or "history" (its code's versions); "notes" is the Markdown page, which the page view draws itself. */
  side: SmartSide;
  onSide(side: SmartSide): void;
  backend?: SmartBackend;
  /** How the code editor asks the app; the desktop app's own unless a test gives another. */
  author?: AuthorBackend;
}

/**
 * A smart page opened on its own: full width, with a header that switches
 * between its smart view, its notes and the history of its code. The notes
 * side is the ordinary page, drawn by the page view around this one.
 */
export function SmartPage({ pagePath, pageId, title, side, onSide, backend, author }: Props) {
  const asked = backend ?? tauriSmartBackend;
  const desktop = backend !== undefined || inTauri();
  const [reload, setReload] = useState(0);
  const trust = useTrust(pagePath, asked, desktop);
  const { info, failed, patch } = usePageInfo(pagePath, asked, desktop, reload);
  const [problem, setProblem] = useState<string | null>(null);

  const smart = () => {
    if (!desktop) return <p className="kasten-smart-note">Smart pages open in the KastenFlow app.</p>;
    if (failed) {
      return (
        <div className="kasten-smart-note">
          <p>“{title}” could not be opened as a smart page.</p>
          <Button size="sm" onClick={() => onSide("notes")}>
            Show its notes
          </Button>
        </div>
      );
    }
    if (trust.trust === null || info === null) {
      return (
        <p className="kasten-smart-wait" role="status">
          Loading this page…
        </p>
      );
    }
    if (trust.trust.needsAllow) return <AllowRun madeBy={trust.trust.madeBy ?? "an agent"} unknownMaker={trust.trust.unknownMaker} onAllow={() => void trust.allow()} busy={trust.busy} problem={trust.problem} />;
    if (!info.ready) {
      return (
        <div className="kasten-smart-note kasten-smart-empty">
          <p>{NO_VIEW_LINE}</p>
          {info.problems.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <Button size="sm" onClick={() => void import("./author/starter-picker").then((m) => m.chooseStarter({ turnInto: pagePath, onDone: () => setReload((n) => n + 1), backend: author }))}>
            Start from a starter
          </Button>
          <Button size="sm" onClick={() => onSide("notes")}>
            Show its notes
          </Button>
        </div>
      );
    }
    return (
      <>
        <div className="kasten-smart-stage">
          <SmartFrame pagePath={pagePath} pageId={pageId} title={title} backend={asked} fill reloadKey={`${reload}:${info.webImages}`} />
        </div>
        <Disclosure id="smart-page-options" title="Page options" className="kasten-smart-options">
          <label className="kasten-smart-check">
            <input
              type="checkbox"
              aria-describedby="kasten-smart-pictures-warning"
              checked={info.webImages}
              onChange={(event) => {
                const allow = event.target.checked;
                setProblem(null);
                asked.setWebImages(pagePath, allow).then(
                  () => patch({ webImages: allow }),
                  (err: unknown) => setProblem(err instanceof Error ? err.message : "That did not work."),
                );
              }}
            />
            <span>Allow pictures from the web</span>
          </label>
          <p id="kasten-smart-pictures-warning" className="kasten-smart-warning">
            {PICTURES_WARNING}
          </p>
          {problem && (
            <p role="alert" className="kasten-smart-allow-problem">
              {problem}
            </p>
          )}
        </Disclosure>
      </>
    );
  };

  return (
    <div className="kasten-smart-page">
      <header className="kasten-smart-bar">
        <h1 className="kasten-smart-title">{title}</h1>
        <SmartTabs side={side === "code" ? "smart" : side} onSide={onSide} />
        {side === "smart" && desktop && <IconButton icon="refresh" label="Reload this page" size="sm" onClick={() => setReload((n) => n + 1)} />}
        {(side === "smart" || side === "code") && desktop && <IconButton icon="code" label="Edit code" size="sm" active={side === "code"} onClick={() => onSide(side === "code" ? "smart" : "code")} />}
        {side === "smart" && desktop && <IconButton icon="layout" label="Improve its layout with AI" size="sm" onClick={() => void import("./chat").then((m) => m.improveLayout(pagePath, title))} />}
        {side === "smart" && desktop && <IconButton icon="wand" label="Fix its errors with AI" size="sm" onClick={() => void import("./chat").then((m) => m.fixErrors(pagePath, title))} />}
      </header>
      {side === "history" ? (
        <HistoryTab pagePath={pagePath} backend={asked} onRestored={() => setReload((n) => n + 1)} />
      ) : side === "code" ? (
        <Suspense fallback={<p className="kasten-smart-wait">Opening the editor…</p>}>
          <AuthorPane pagePath={pagePath} pageId={pageId} title={title} backend={backend} author={author} />
        </Suspense>
      ) : (
        smart()
      )}
    </div>
  );
}
