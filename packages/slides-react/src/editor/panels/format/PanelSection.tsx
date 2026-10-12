import { type ReactNode, createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { chromeOf, useChromeValue } from "../../chrome/chrome.ts";
import { moveMs, play } from "../../motion.ts";
import type { EditorUi } from "../../ui-state.ts";
import { Icon } from "../../ui/Icon.tsx";
import "./format.css";

/** Which sections the person folded away. Kept above the sections, so a section that leaves and comes back finds itself as it was. */
export interface Folds {
  isClosed(id: string): boolean;
  toggle(id: string): void;
}

const FoldsContext = createContext<Folds | null>(null);

/**
 * The fold state for a group of sections, kept in this browser (the chrome's): a section folded stays folded the next time, in this
 * deck and in any other. The ones named start folded away until the person opens them.
 */
export function useFolds(ui: EditorUi, startClosed: readonly string[] = []): Folds {
  const folds = useChromeValue(ui, (state) => state.folds);
  const chrome = chromeOf(ui);
  const start = startClosed.join(",");
  return useMemo(
    () => ({
      isClosed: (id) => folds[id] ?? start.split(",").includes(id),
      toggle: (id) => chrome.toggleFold(id, start.split(",").includes(id)),
    }),
    [folds, chrome, start],
  );
}

export function FoldsProvider({ folds, children }: { folds: Folds; children: ReactNode }) {
  return <FoldsContext value={folds}>{children}</FoldsContext>;
}

interface PanelSectionProps {
  /** Names the section for its folded state. */
  id: string;
  title: string;
  children: ReactNode;
}

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * A group of controls under a title with a chevron: pressing the title folds it away. It opens and closes by sliding its height over the
 * `--ks-base` time (not at all where motion is off), and never moves what is typed in it.
 */
export function PanelSection({ id, title, children }: PanelSectionProps) {
  const folds = useContext(FoldsContext);
  const [alone, setAlone] = useState(true);
  const open = folds ? !folds.isClosed(id) : alone;
  const body = useId();
  const content = useRef<HTMLDivElement>(null);
  /** Folding: the body stays drawn until its height has gone down to nothing. */
  const [closing, setClosing] = useState(false);
  const seen = useRef(open);

  useLayoutEffect(() => {
    if (seen.current === open) return;
    seen.current = open;
    const node = content.current;
    if (!node) return setClosing(false);
    const done = () => {
      node.style.overflow = "";
      setClosing(false);
    };
    if (open) {
      setClosing(false);
      const slide = play(node, [{ height: "0px", opacity: 0 }, { height: `${node.scrollHeight}px`, opacity: 1 }], { duration: moveMs(node), easing: EASE });
      if (slide) {
        node.style.overflow = "hidden";
        void slide.finished.then(done, done);
      }
    } else {
      const slide = play(node, [{ height: `${node.scrollHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: moveMs(node), easing: EASE });
      if (!slide) return done();
      node.style.overflow = "hidden";
      void slide.finished.then(done, done);
    }
  }, [open]);

  const toggle = () => {
    // The body of a section that is being folded is drawn until the fold is done.
    if (open) setClosing(true);
    if (folds) folds.toggle(id);
    else setAlone(!open);
  };

  return (
    <section className="ks-sp-section" data-section={id}>
      <h3 className="ks-sp-section-title">
        <button type="button" className="ks-sp-section-toggle" aria-expanded={open} aria-controls={body} onClick={toggle}>
          <span>{title}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      </h3>
      <div id={body} ref={content} className="ks-sp-section-body" hidden={!open && !closing}>
        {children}
      </div>
    </section>
  );
}
