import type { JSX } from "react";

import { colorOf, placeholderOf } from "../../theme/index.ts";
import type { ViewProps } from "../context.ts";
import { paintsBox } from "../style.ts";
import { columnClass, columnsOf, gapOf, gapStyle } from "../text-columns.ts";
import { isBlankText } from "../text-props.ts";
import "../text-columns.css";
import { ShapeGraphic } from "./ShapeGraphic.tsx";
import { TextArea } from "./TextArea.tsx";
import { Upright } from "./Upright.tsx";

/** What an editor says in a text box of its own that has no words yet (a layout's slot says what its layout wrote). */
export const EMPTY_BOX_PROMPT = "Click to add text";

/** A text box. Its style, which a plain box does not have, paints the box behind the words. */
export function TextView({ element, box, cx, hideText }: ViewProps<"text">): JSX.Element {
  const slot = placeholderOf(cx.theme, cx.layout, element);
  const radius = element.style?.radius ?? 0;
  // An empty box of its own is kept, so an editor must be able to see it: a faint dashed outline and a prompt. Never in a show, a
  // thumbnail or an export, where an empty box is simply nothing.
  const bare = cx.mode === "edit" && isBlankText(element.text);
  const own = bare && element.placeholder == null;
  const columns = columnsOf(element.columns);
  const area = (
    <TextArea
      cx={cx}
      text={element.text}
      baseStyle={slot?.style ?? "body"}
      width={box.w}
      height={box.h}
      valign={element.text.valign ?? slot?.valign ?? "top"}
      prompt={bare ? (slot?.prompt ?? (own ? EMPTY_BOX_PROMPT : undefined)) : undefined}
      className={columnClass(columns)}
    />
  );
  return (
    <>
      {paintsBox(element.style) && (
        <ShapeGraphic theme={cx.theme} style={element.style} name={radius > 0 ? "roundRect" : "rect"} w={box.w} h={box.h} adjust={radius} />
      )}
      {own && !hideText && <div className="ks-empty-box" aria-hidden="true" style={{ borderColor: colorOf(cx.theme, "text2", 0.45) }} />}
      {!hideText && (
        <Upright flipH={element.flipH} flipV={element.flipV}>
          {columns > 1 ? (
            <div className="ks-cols-wrap" style={gapStyle(gapOf(element.columnGap))}>
              {area}
            </div>
          ) : (
            area
          )}
        </Upright>
      )}
    </>
  );
}
