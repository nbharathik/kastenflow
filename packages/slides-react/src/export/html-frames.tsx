// The live frames of the exported web page. The page holds each embedded web page as an empty frame over the still the slide draws for it
// (its poster, or a panel with the address); the page's script gives the frame its address when its slide is shown and the network is
// there, and shows it once it has loaded. Offline, or where a site will not be shown in a frame, the still stays: it links to the page.

import type { Deck, Slide } from "@kasten-slides/wasm";
import type { CSSProperties, JSX } from "react";

import { stageStyle } from "../embed/EmbedBox.tsx";
import { isPageEmbedElement } from "../embed/kinds.ts";
import { DEFAULT_DESIGN, frameFor, viewOf } from "../embed/scale.ts";
import { liveItems } from "../present/live-items.ts";
import { EMBED_ALLOW, EMBED_REFERRER, embedSandbox, frameAddress } from "../present/live-url.ts";

/** Providers whose player refuses a page that has no web address of its own (a file opened from disk sends no referrer). */
const NEEDS_ADDRESS = new Set(["youtube"]);

/** The frames of the embedded web pages a slide shows at a step; `step` is -1 for a slide with no steps. */
export function ExportFrames({ deck, slide, step }: { deck: Deck; slide: Slide; step: number }): JSX.Element | null {
  const frames = liveItems(deck, slide, step).flatMap((item) => {
    const { element } = item;
    if (element.type !== "embed" || isPageEmbedElement(element)) return [];
    const framed = frameAddress(element);
    return framed ? [{ item, element, framed }] : [];
  });
  if (frames.length === 0) return null;
  return (
    <div className="ks-show-live" style={{ width: deck.size.w, height: deck.size.h }}>
      {frames.map(({ item, element, framed }) => {
        const { box } = item;
        const video = framed.link.kind === "video";
        const view = video ? { design: { w: box.w, h: box.h }, zoom: null, fit: "page" as const } : viewOf(element, DEFAULT_DESIGN);
        const stage = video ? { left: 0, top: 0, width: "100%", height: "100%" } : stageStyle(frameFor(box, view));
        const place: CSSProperties = {
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          ...(element.rotation ? { transform: `rotate(${element.rotation}deg)` } : {}),
          ...(item.opacity < 1 ? { opacity: item.opacity } : {}),
        };
        return (
          <div key={element.id} className="ks-show-live-item" style={place}>
            <div className="ks-embed-box" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
              <div className="ks-embed-stage" style={{ position: "absolute", transformOrigin: "0 0", ...stage }}>
                <iframe
                  className="ks-show-live-frame"
                  title={element.title || element.alt || "Embedded page"}
                  sandbox={embedSandbox(framed.url, "null")}
                  referrerPolicy={EMBED_REFERRER}
                  allow={EMBED_ALLOW}
                  allowFullScreen
                  data-ks-live={framed.url}
                  data-ks-needs-address={NEEDS_ADDRESS.has(framed.link.provider) ? "" : undefined}
                  style={{ opacity: 0, border: 0, width: "100%", height: "100%", display: "block" }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
