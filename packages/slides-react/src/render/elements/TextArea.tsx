import type { Text, VAlign } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { DEFAULT_INSETS } from "../../text/metrics.ts";
import { FittedTextBlock } from "../../text/FittedTextBlock.tsx";
import type { RenderCx } from "../context.ts";
import type { TextBlockExtras } from "../text-props.ts";

export interface TextAreaProps {
  cx: RenderCx;
  text: Text;
  /** The theme text style the text starts from. */
  baseStyle: string;
  /** The size of the box the text fills, in slide units. */
  width: number;
  height: number;
  valign: VAlign;
  /** What an editor shows in the box while the text is empty. */
  prompt?: string | undefined;
}

/** Words in a box: the one place the renderer calls the text module. */
export function TextArea({ cx, text, baseStyle, width, height, valign, prompt }: TextAreaProps): JSX.Element {
  const extras: TextBlockExtras = {
    insets: text.insets ?? DEFAULT_INSETS,
    valign,
    fields: cx.fields,
    step: cx.step,
    emptyPrompt: prompt,
  };
  return <FittedTextBlock theme={cx.theme} text={text} baseStyle={baseStyle} width={width} height={height} {...extras} />;
}
