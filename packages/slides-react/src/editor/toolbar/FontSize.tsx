import type { JSX } from "react";

import { textFormat } from "../commands/index.ts";
import { useReturnFocus } from "../menus/focus.ts";
import { plainItem } from "../menus/build.ts";
import type { EditorUi } from "../ui-state.ts";
import { NumberField } from "../ui/Fields.tsx";
import { MenuButton, ToolButton } from "./ToolButton.tsx";
import type { TextView } from "./useTextView.ts";

/**
 * The size of the words in hand: smaller and bigger buttons that step along
 * the usual sizes, a box to type one, and a list of the usual sizes under it.
 * The box shows the text style's size for words that set none, and nothing
 * where the selection disagrees.
 */
export function FontSize({ view, ui }: { view: TextView; ui: EditorUi }): JSX.Element {
  const { ctx, format, can, base } = view;
  const size = typeof format.size === "number" ? format.size : format.size === "mixed" ? "mixed" : base.size;
  const back = useReturnFocus(ui);
  return (
    <span
      className="ks-tb-size"
      role="group"
      aria-label="Font size"
      data-ks-keep-focus=""
      onFocus={back.remember}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") back.restore();
      }}
    >
      <ToolButton icon="minus" label="Decrease font size" disabled={!can} onClick={() => textFormat.stepSize(ctx, -1, base.size)} />
      <NumberField label="Font size" value={size} min={1} max={400} decimals={1} width={40} disabled={!can} onCommit={(points) => textFormat.setSize(ctx, points)} />
      <MenuButton
        ui={ui}
        label="Font sizes"
        className="ks-tb-size-list"
        disabled={!can}
        items={() => textFormat.SIZES.map((points) => plainItem(`size-${points}`, String(points), () => textFormat.setSize(ctx, points), { checked: size === points }))}
      />
      <ToolButton icon="plus" label="Increase font size" disabled={!can} onClick={() => textFormat.stepSize(ctx, 1, base.size)} />
    </span>
  );
}
