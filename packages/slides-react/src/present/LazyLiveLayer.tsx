// The live layer of a slide, loaded when the slide has something live. Frames, players and page views stay out of
// the code a show loads up front: a slide without embeds or videos draws exactly as before, and one with them gets
// its layer a moment later (nothing is drawn for it until then).

import { type JSX, Suspense, lazy, useMemo } from "react";

import { liveItems } from "./live-items.ts";
import type { LiveLayerProps } from "./Live.tsx";

const Layer = lazy(async () => ({ default: (await import("./Live.tsx")).LiveLayer }));

export function LazyLiveLayer(props: LiveLayerProps): JSX.Element | null {
  const { deck, slide, step, ready = false } = props;
  const any = useMemo(() => liveItems(deck, slide, step).some((item) => !ready || item.element.type === "video"), [deck, slide, step, ready]);
  if (!any) return null;
  return (
    <Suspense fallback={null}>
      <Layer {...props} />
    </Suspense>
  );
}
