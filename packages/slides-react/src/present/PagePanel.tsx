// A page of the host shown over a presentation, at the side, when a link to it is followed. The host draws the page; this is the
// calm frame round it: it slides in at the right, leaves the slide visible beside it, and Esc (or its button) puts it away and
// returns to the slide, before the presentation's own Esc could end the show.

import { type ComponentType, type JSX, useEffect, useRef } from "react";

import type { PagePanelProps } from "../editor/host.ts";
import "./panel.css";

export interface PagePanelFrameProps {
  Panel: ComponentType<PagePanelProps>;
  path: string;
  section: string | null;
  onClose(): void;
}

export function PagePanel({ Panel, path, section, onClose }: PagePanelFrameProps): JSX.Element {
  const frame = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The panel has the keys while it is open (it can be scrolled), and gives them back when it closes.
  useEffect(() => {
    frame.current?.focus({ preventScroll: true });
  }, [path, section]);

  return (
    <aside ref={frame} className="ks-show-panel" role="dialog" aria-label="Page" aria-modal="false" tabIndex={-1}>
      <button type="button" className="ks-show-panel-close" aria-label="Close the page and return to the slide" title="Back to the slide (Esc)" onClick={onClose}>
        Esc
      </button>
      <div className="ks-show-panel-body">
        <Panel path={path} section={section} onClose={onClose} />
      </div>
    </aside>
  );
}
