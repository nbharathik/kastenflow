import type { JSX } from "react";
import { useEffect, useState } from "react";

import { diagramOf, editedLocally, revisionOf } from "../diagrams.ts";
import { refreshDiagram, staleDiagrams, type StaleDiagram } from "../diagram-refresh.ts";
import type { EditorSession } from "../session/session.ts";
import { useEditorValue } from "../useEditor.ts";
import "./diagram-badges.css";

/** How far in from the corner of a picture its badge sits, in pixels on screen; and the height it takes above the picture. */
const INSET = 4;
const ABOVE = 30;

/** Which pictures of diagrams the slide shows, at what version, and whether the person worked on them: when this changes the host is asked again. */
const keyOf = (session: EditorSession): string =>
  session.slide.elements
    .flatMap(function pictures(element): string[] {
      if (element.type === "group") return element.children.flatMap(pictures);
      const source = diagramOf(element);
      return source ? [`${element.id}|${element.type === "image" ? element.src : ""}|${source}|${revisionOf(element) ?? ""}|${editedLocally(element) ? "edited" : ""}`] : [];
    })
    .join(",");

/**
 * A badge on each picture of a diagram that changed after the picture was drawn: "Diagram changed", and Refresh. A picture the person
 * cropped or described offers two ways to refresh, keeping their work or not, rather than overwriting it. Drawn over the slide, never
 * in it, so it is in no thumbnail and no export. Where the host cannot say whether a diagram changed, nothing is drawn at all.
 */
export function DiagramBadges({ session, zoom, hidden = false }: { session: EditorSession; zoom: number; hidden?: boolean }): JSX.Element | null {
  const { host } = session;
  const slideId = useEditorValue(session, (state) => state.slideId);
  const pictures = useEditorValue(session, () => (host.diagramRevision ? keyOf(session) : ""));
  const [stale, setStale] = useState<StaleDiagram[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Counts the host's "a diagram changed", so the pictures are asked about again.
  const [changes, setChanges] = useState(0);

  useEffect(() => host.watchDiagrams?.(() => setChanges((n) => n + 1)), [host]);
  useEffect(() => {
    if (!pictures) return void setStale([]);
    let live = true;
    void staleDiagrams(session).then((found) => live && setStale(found));
    return () => {
      live = false;
    };
  }, [session, slideId, pictures, changes]);

  // While a block is dragged or resized the badge would stay where it was: it returns when the gesture ends.
  if (stale.length === 0 || hidden) return null;
  const run = async (item: StaleDiagram, how: "replace" | "keep") => {
    setBusy(item.id);
    try {
      await refreshDiagram(session, slideId, item.id, how);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="ks-diagram-layer" data-selbar="">
      {stale.map((item) => {
        const [element] = session.elements.find([item.id]);
        const box = element ? session.elements.boxOf(element) : null;
        if (!box) return null;
        const above = box.y * zoom - ABOVE;
        const top = above >= 2 ? above : box.y * zoom + INSET;
        const working = busy === item.id;
        return (
          <div key={item.id} className="ks-diagram-badge" role="group" aria-label={`${item.name}: the diagram changed`} data-diagram-badge={item.id} style={{ left: box.x * zoom + INSET, top }}>
            <span className="ks-diagram-badge-text" title={`The diagram “${item.name}” changed after this picture was drawn.`}>
              Diagram changed
            </span>
            {item.edited ? (
              <>
                <button type="button" disabled={working} aria-label={`Refresh ${item.name} and keep my crop and description`} title="Draw the diagram again and keep the crop and the description you gave this picture" onClick={() => void run(item, "keep")}>
                  {working ? "Drawing…" : "Refresh, keep my edits"}
                </button>
                <button type="button" disabled={working} aria-label={`Refresh ${item.name} and drop my crop and description`} title="Draw the diagram again and start the picture over: its crop and description are replaced" onClick={() => void run(item, "replace")}>
                  Replace
                </button>
              </>
            ) : (
              <button type="button" disabled={working} aria-label={`Refresh ${item.name}`} title="Draw the diagram again and put the new picture here" onClick={() => void run(item, "replace")}>
                {working ? "Drawing…" : "Refresh"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
