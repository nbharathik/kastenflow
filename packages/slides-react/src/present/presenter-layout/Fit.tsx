// A slide that fills its panel: scaled as large as the panel's width and height allow at the deck's own proportions, and centred.
// The panel is a size container, so the frame's width is `min(100cqw, 100cqh * ratio)` (see layout.css); `Scaled` then follows the frame.

import type { Deck } from "@kasten-slides/wasm";
import type { JSX, ReactNode } from "react";

import { Scaled } from "../ScrollView.tsx";

export function Fit({ deck, strip, children }: { deck: Deck; strip?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className={strip ? "ks-pv-fit is-strip" : "ks-pv-fit"}>
      <Scaled deck={deck}>{children}</Scaled>
    </div>
  );
}
