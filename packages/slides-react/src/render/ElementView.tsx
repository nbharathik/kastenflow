// One element of a slide, in the box that lets an editor find it.

import { type JSX, type MemoExoticComponent, memo } from "react";
import type { Element } from "@kasten-slides/wasm";

import { safeLink } from "../text/links.ts";
import { type Box, boxOf, colorOf } from "../theme/index.ts";
import type { RenderCx } from "./context.ts";
import { ConnectorView } from "./elements/ConnectorView.tsx";
import { ImageView, maskRadius } from "./elements/ImageView.tsx";
import { LineView } from "./elements/LineView.tsx";
import { MathView } from "./elements/MathView.tsx";
import { RawBox, RawView } from "./elements/RawView.tsx";
import { ShapeView } from "./elements/ShapeView.tsx";
import { TableView } from "./elements/TableView.tsx";
import { TextView } from "./elements/TextView.tsx";
import { jsonEqual } from "./equal.ts";
import { clamp } from "./format.ts";
import { frameStyle, opacityOf } from "./frame.ts";
import { placedElement, useLiveBox } from "./live.ts";
import { roundingOf } from "./shapes/index.ts";
import { sameApartFromStep } from "./step-memo.ts";
import { isUndrawn, stateOf } from "./visibility.ts";

export interface ElementViewProps {
  element: Element;
  cx: RenderCx;
  /** The element whose text an editor draws over the slide instead, if any. */
  hideTextOf: string | null;
  /** Whether a group that holds the element is hidden at this step. */
  groupHidden?: boolean;
}

const holds = (element: Element, id: string): boolean =>
  element.id === id || (element.type === "group" && element.children.some((child) => holds(child, id)));

/** The id of the element to leave the text out of, when it is this element or in it; null when it does not concern it. */
const hidingIn = (element: Element, hideTextOf: string | null): string | null => (hideTextOf !== null && holds(element, hideTextOf) ? hideTextOf : null);

/** Where a group is, for the outline of a highlighted one: its own box, or the box around what it holds. */
function groupBox(group: Extract<Element, { type: "group" }>, cx: RenderCx): Box | null {
  const own = boxOf(cx.theme, cx.layout, group);
  if (own) return own;
  const boxes = group.children.flatMap((child) => {
    const box = child.type === "group" ? groupBox(child, cx) : boxOf(cx.theme, cx.layout, child);
    return box ? [box] : [];
  });
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** How far the highlight stands off the element, so that it shows on an element outlined in the same colour. */
const HIGHLIGHT_GAP = 2;

/** The rounding of the highlight of an element whose outline is rounded, so the ring follows it. */
function roundingOfElement(element: Element, box: Box): string | undefined {
  switch (element.type) {
    case "shape":
      return roundingOf(element.shape, box.w, box.h, element.style?.radius);
    case "image":
      return maskRadius(element.mask, element.style?.radius, box.w, box.h);
    case "text":
      return element.style?.radius ? roundingOf("roundRect", box.w, box.h, element.style.radius) : undefined;
    default:
      return undefined;
  }
}

/** The theme's highlight: an outline round the box (given, for a group) of the colour and width the theme names. */
function Highlight({ cx, box, borderRadius }: { cx: RenderCx; box?: Box; borderRadius?: string | undefined }): JSX.Element {
  const { color, width } = cx.theme.highlight;
  const ring = { outline: `${clamp(width, 0, 100)}px solid ${colorOf(cx.theme, color)}`, outlineOffset: HIGHLIGHT_GAP, borderRadius };
  return <div className="ks-highlight" style={box ? { left: box.x, top: box.y, width: box.w, height: box.h, ...ring } : ring} />;
}

/**
 * What Morph pairs an element by, when a slide is presented: the same on two slides for elements that are the same
 * thing (`data-id`, the name Auto-Animate looks for). Left off when not presenting, so it is not in the way of an editor.
 */
function morphKey(element: Element, cx: RenderCx): string | undefined {
  return cx.mode === "present" ? (element.morphId ?? element.id) : undefined;
}

/** The words an assistive technology is told for an element that has none of its own. */
function description(element: Element): { role: "img"; "aria-label": string } | undefined {
  const named = element.type === "shape" || element.type === "line" || element.type === "connector" || element.type === "raw";
  return named && element.alt ? { role: "img", "aria-label": element.alt } : undefined;
}

function Content({ element, box, cx, hideText }: { element: Exclude<Element, { type: "group" }>; box: Box; cx: RenderCx; hideText: boolean }): JSX.Element | null {
  switch (element.type) {
    case "text":
      return <TextView element={element} box={box} cx={cx} hideText={hideText} />;
    case "shape":
      return <ShapeView element={element} box={box} cx={cx} hideText={hideText} />;
    case "line":
      return <LineView element={element} box={box} cx={cx} hideText={hideText} />;
    case "connector":
      return <ConnectorView element={element} box={box} cx={cx} hideText={hideText} />;
    case "image":
      return <ImageView element={element} box={box} cx={cx} hideText={hideText} />;
    case "table":
      return <TableView element={element} box={box} cx={cx} hideText={hideText} />;
    case "math":
      return <MathView element={element} box={box} cx={cx} hideText={hideText} />;
    case "raw":
      return <RawView element={element} box={box} cx={cx} hideText={hideText} />;
    default:
      // A kind of element from a newer format than this build knows: shown as a labelled box so that nothing is silently lost.
      return <RawBox cx={cx} label={(element as { type: string }).type} />;
  }
}

function ElementViewImpl({ element: given, cx, hideTextOf, groupHidden = false }: ElementViewProps): JSX.Element | null {
  const { theme } = cx;
  // While the editor drags this element somewhere it says where; only this view is drawn again for each step.
  const placed = useLiveBox(given.id);
  const element = given.type === "group" ? given : placedElement(given, placed);
  const state = stateOf(element, cx.step, groupHidden);
  if (state === "hidden" && cx.mode !== "edit") return null;
  if (isUndrawn(element, cx.mode, cx.master)) return null;

  if (element.type === "group") {
    const box = state === "highlighted" ? groupBox(element, cx) : null;
    const opacity = state === "hidden" ? 1 : opacityOf(element, state, theme);
    return (
      <div
        className="ks-group"
        data-el={element.id}
        data-id={morphKey(element, cx)}
        data-type="group"
        data-master={cx.master || undefined}
        role={element.alt ? "group" : undefined}
        aria-label={element.alt ?? undefined}
        style={{ position: "absolute", left: 0, top: 0, width: cx.size.w, height: cx.size.h, pointerEvents: "none", ...(opacity === 1 ? {} : { opacity }) }}
      >
        {element.children.map((child) => (
          <ElementView key={child.id} element={child} cx={cx} hideTextOf={hideTextOf} groupHidden={state === "hidden"} />
        ))}
        {box && <Highlight cx={cx} box={box} />}
      </div>
    );
  }

  const box = boxOf(theme, cx.layout, element);
  if (!box) return null;
  const ghost = state === "hidden";
  return (
    <div
      className={ghost ? "ks-el ks-ghost" : "ks-el"}
      data-el={element.id}
      data-id={morphKey(element, cx)}
      data-type={element.type}
      data-placeholder={element.placeholder ?? undefined}
      data-master={cx.master || undefined}
      // What an element links to is followed in a presentation, from here: the address is only read there.
      data-link={cx.mode === "present" ? (safeLink(element.link) ?? undefined) : undefined}
      style={frameStyle(box, element, opacityOf(element, state, theme))}
      {...description(element)}
    >
      {ghost ? (
        <div className="ks-ghost-box" style={{ borderColor: colorOf(theme, "text2") }} />
      ) : (
        <>
          <Content element={element} box={box} cx={cx} hideText={element.id === hideTextOf} />
          {state === "highlighted" && <Highlight cx={cx} borderRadius={roundingOfElement(element, box)} />}
        </>
      )}
    </div>
  );
}

/**
 * Draws one element. A change to a deck hands over new copies of the slides
 * it touches, in which an element that did not change is the very object it
 * was, so the views of elements ask first whether they were given the same
 * object (one comparison) and only when they were not compare what they were
 * given by content: an element that did not change is not drawn again.
 */
export const ElementView: MemoExoticComponent<(props: ElementViewProps) => JSX.Element | null> = memo(ElementViewImpl, (a, b) => {
  if (a.element === b.element && a.cx === b.cx && a.groupHidden === b.groupHidden && a.hideTextOf === b.hideTextOf) return true;
  return (
    (a.cx === b.cx || sameApartFromStep(a.cx, b.cx, a.element)) &&
    (a.groupHidden ?? false) === (b.groupHidden ?? false) &&
    hidingIn(a.element, a.hideTextOf) === hidingIn(b.element, b.hideTextOf) &&
    (a.element === b.element || jsonEqual(a.element, b.element))
  );
});
