import "./smart.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { inTauri } from "../../lib/api";
import { Button } from "../../ui/Button";
import { tauriSmartBackend, type SmartBackend } from "./backend";
import { AllowRun } from "./AllowRun";
import { claim, FULL_LINE, release, type Runner } from "./live-frames";
import { useSmartRunning } from "./run-switch";
import { SmartFrame } from "./SmartFrame";
import { SmartOffLine } from "./SmartTabs";
import { entryOfView, usePageInfo } from "./use-page-info";
import { useTrust } from "./use-trust";
import { NO_VIEW_LINE } from "./words";

export interface SmartBlockProps {
  /** The smart page's path and id. */
  pagePath: string;
  pageId: string;
  title: string;
  /** The named view (`![[Page#deadlines]]`); the page is told. */
  view?: string;
  /** The page this block sits in: at most four blocks run at once in one page. */
  scope: string;
  backend?: SmartBackend;
}

type Place = "waiting-to-be-seen" | "live" | "waiting";

/**
 * A smart page shown as a block inside another page (`![[Conference tracker]]`):
 * the live view, as tall as it asks (never over 1,200 px). It loads when it is
 * scrolled into view, at most four run at once in a page (the rest wait behind
 * "Click to run"), and it waits for a person's "Allow to run" when an agent
 * made it. The Markdown holds only the link, never HTML or scripts.
 */
export function SmartBlock({ pagePath, pageId, title, view = "", scope, backend }: SmartBlockProps) {
  const asked = backend ?? tauriSmartBackend;
  const desktop = backend !== undefined || inTauri();
  const run = useSmartRunning(asked, desktop, pagePath);
  const trust = useTrust(pagePath, asked, desktop);
  const { info, failed } = usePageInfo(pagePath, asked, desktop);
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [place, setPlace] = useState<Place>("waiting-to-be-seen");
  const [full, setFull] = useState(false);

  // One runner for the block's life, so a place is its own.
  const runner = useRef<Runner>({ onScreen: false, evict: () => {} });
  runner.current.evict = () => setPlace("waiting");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      runner.current.onScreen = true;
      setSeen(true);
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      runner.current.onScreen = last.isIntersecting;
      if (last.isIntersecting) setSeen(true);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const ready = desktop && run.known && run.on && trust.trust !== null && !trust.trust.needsAllow && info !== null && info.ready;

  // A place is taken when the block is first in view and may run; it is given back when it may not, or goes away.
  useEffect(() => {
    if (ready && seen && place === "waiting-to-be-seen") setPlace(claim(scope, runner.current) ? "live" : "waiting");
    if (!ready && place === "live") {
      release(scope, runner.current);
      setPlace("waiting-to-be-seen");
    }
  }, [ready, seen, place, scope]);
  useEffect(() => {
    const mine = runner.current;
    return () => release(scope, mine);
  }, [scope]);

  const clickToRun = useCallback(() => {
    if (claim(scope, runner.current, true)) {
      setFull(false);
      setPlace("live");
    } else {
      setFull(true);
    }
  }, [scope]);

  const body = () => {
    if (!desktop) return <p className="kasten-smart-note">Smart pages open in the KastenFlow app.</p>;
    if (run.known && !run.on) return <SmartOffLine backend={asked} page={pagePath} />;
    if (failed) return <p className="kasten-smart-note">“{title}” could not be opened as a smart page.</p>;
    if (!run.known || trust.trust === null || info === null) {
      return (
        <p className="kasten-smart-wait" role="status">
          Loading this page…
        </p>
      );
    }
    if (trust.trust.needsAllow) return <AllowRun compact madeBy={trust.trust.madeBy ?? "an agent"} unknownMaker={trust.trust.unknownMaker} onAllow={() => void trust.allow()} busy={trust.busy} problem={trust.problem} />;
    if (!info.ready) return <p className="kasten-smart-note">{NO_VIEW_LINE}</p>;
    if (place === "live") {
      const named = view ? entryOfView(info, view) : null;
      return (
        <SmartFrame
          pagePath={pagePath}
          pageId={pageId}
          title={title}
          backend={asked}
          {...(named?.name ? { view: named.name } : {})}
          {...(named?.entry ? { entry: named.entry } : {})}
          {...(info.height ? { height: info.height } : {})}
          {...(info.maxHeight ? { maxHeight: info.maxHeight } : {})}
          reloadKey={info.webImages ? "web" : "no-web"}
        />
      );
    }
    if (place === "waiting") {
      return (
        <div className="kasten-smart-note kasten-smart-paused">
          <Button size="sm" onClick={clickToRun}>
            Click to run
          </Button>
          <span>{title}</span>
          {full && (
            <span role="status" className="kasten-smart-full">
              {FULL_LINE}
            </span>
          )}
        </div>
      );
    }
    return (
      <p className="kasten-smart-wait" role="status">
        Loading this page…
      </p>
    );
  };

  return (
    <div ref={box} className="kasten-smart-block" data-place={place}>
      {body()}
    </div>
  );
}
