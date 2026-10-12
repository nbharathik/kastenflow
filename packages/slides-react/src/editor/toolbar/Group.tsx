import { type JSX, type ReactNode, createContext, useContext } from "react";

/** Which groups of the toolbar are drawn where this is read: in the bar itself, or in the "more" menu that takes what did not fit. */
export interface Shown {
  shows(id: string): boolean;
}

export const ShownContext = createContext<Shown>({ shows: () => true });

/**
 * A run of related buttons, set off from its neighbours by a rule. It draws nothing where it is not shown, so the same list of groups is
 * drawn in the bar (the groups that fit) and in the more menu (the ones that did not) without either knowing about the other.
 */
export function Group({ id, children }: { id: string; children: ReactNode }): JSX.Element | null {
  const { shows } = useContext(ShownContext);
  if (!shows(id)) return null;
  return (
    <div className="ks-tb-group" role="group" data-group={id} aria-label={LABELS[id] ?? id}>
      {children}
    </div>
  );
}

const LABELS: Record<string, string> = {
  history: "History",
  zoom: "Zoom",
  insert: "Insert",
  slide: "Slide",
  font: "Font",
  marks: "Text style",
  paragraph: "Paragraph",
  shape: "Shape style",
  diagram: "Diagram",
  arrange: "Arrange",
};
