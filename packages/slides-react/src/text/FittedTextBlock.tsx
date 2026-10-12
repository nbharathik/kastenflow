// A text box that "shrinks text on overflow": the words of `TextBlock`, set
// smaller by the scale the page says makes them fit. Every other box is a
// plain `TextBlock`, which is all the lint's measuring (drawn to a string)
// and a page with no layout ever need.

import type { JSX } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { boxOf } from "./box-style.ts";
import { measureRemembered, onFontsLoaded } from "./fit.ts";
import { TextBlock, type TextBlockProps } from "./TextBlock.tsx";

function Shrunk(props: TextBlockProps): JSX.Element {
  const { theme, text, baseStyle, width, height, insets, valign, fields, emptyPrompt } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fonts, setFonts] = useState(0);
  const spacing = boxOf(text, { insets, valign }).insets;
  // Everything the layout depends on, and nothing else, so that a box drawn again is not measured again.
  const key = useMemo(
    () => JSON.stringify([text, baseStyle, theme.fonts, theme.textStyles, width, height, spacing, fields ?? null, emptyPrompt ?? null]),
    [text, baseStyle, theme.fonts, theme.textStyles, width, height, spacing.left, spacing.top, spacing.right, spacing.bottom, fields, emptyPrompt],
  );

  useLayoutEffect(() => onFontsLoaded(() => setFonts((n) => n + 1)), []);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const find = (): boolean => {
      const made = measureRemembered(key, element, { width, height, insets: spacing }, true);
      setScale(made.measured ? made.scale : 1);
      return made.measured;
    };
    if (find() || typeof ResizeObserver === "undefined") return;
    // Nothing was shown to ask: look again when it is.
    const watch = new ResizeObserver(() => {
      if (find()) watch.disconnect();
    });
    watch.observe(element);
    return () => watch.disconnect();
    // `spacing` is read through the key.
  }, [key, fonts]);

  return <TextBlock {...props} fitScale={scale} boxRef={box} />;
}

/** The words of a box, set smaller to fit when the text says so. */
export function FittedTextBlock(props: TextBlockProps): JSX.Element {
  return props.text.fit === "shrink" ? <Shrunk {...props} /> : <TextBlock {...props} />;
}
