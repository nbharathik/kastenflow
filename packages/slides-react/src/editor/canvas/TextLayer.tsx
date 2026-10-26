import type { Element, Text } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Upright } from "../../render/elements/Upright.tsx";
import { frameStyle } from "../../render/frame.ts";
import { textRect } from "../../render/index.ts";
import { DEFAULT_INSETS } from "../../text/metrics.ts";
import { type FormatState, TextEditor, type TextEditorHandle } from "../../text/index.ts";
import { boxOf, placeholderOf } from "../../theme/index.ts";
import { isUntouched, settleFresh } from "../quick-add/fresh.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import { linkActions } from "../text-ui/link-actions.ts";
import { LinkPopover } from "../text-ui/LinkPopover.tsx";
import "../text-ui/text-ui.css";
import type { EditorUi } from "../ui-state.ts";
import type { Anchor } from "../ui/Popover.tsx";
import { useEditor } from "../useEditor.ts";

/** A box with nothing typed in it yet: a shape that had no words, or a connector without a label. */
const NO_WORDS: Text = { paragraphs: [{ runs: [{ t: "" }] }] };

const wordsOf = (element: Element): Text | null | undefined => {
  if (element.type === "text") return element.text;
  if (element.type === "shape") return element.text;
  return undefined;
};

/** The link card beside the caret: asked for with Mod-K, or shown where the caret is in a link. */
interface LinkCard {
  mode: "edit" | "card";
  href: string | null;
  anchor: Anchor;
  hasSelection: boolean;
}

/**
 * The open text box, edited in place over the slide: in the same box, with the
 * same padding, alignment and turn as the drawing under it, so nothing moves
 * when editing starts. What is typed goes into the deck when editing ends, as
 * one step of undo; the words in between belong to the text editor, which has
 * its own undo. A box that resizes to fit its words grows and shrinks as they
 * are typed, and is as tall as they are in the deck when editing ends.
 */
export function TextLayer({ session, ui, id }: { session: EditorSession; ui: EditorUi; id: string }): JSX.Element | null {
  const state = useEditor(session);
  const handle = useRef<TextEditorHandle>(null);
  // The words typed and not yet in the deck, and the slide they belong to: editing can end because the person went to another slide.
  const pending = useRef<Text | null>(null);
  const home = useRef(session.slide.id);
  // How tall the words are as they are typed (a box that resizes to fit them), and the height it had.
  const [natural, setNatural] = useState<number | null>(null);
  const grown = useRef<{ natural: number | null; height: number }>({ natural: null, height: 0 });
  const [link, setLink] = useState<LinkCard | null>(null);

  const write = useCallback(() => {
    const text = pending.current;
    pending.current = null;
    // The first words typed into a box made just now are one step of undo with the box.
    const joined = isUntouched(session, id, home.current);
    if (text) session.elements.setText(id, text, home.current, joined);
    const { natural: needed, height } = grown.current;
    // A box that resizes to fit its words is as tall as they are when they are written, in the same step.
    if (text?.fit === "resize" && needed !== null && Math.abs(needed - height) > 0.5) session.elements.setHeight(id, Math.ceil(needed), home.current, true);
  }, [session, id]);

  // Whatever ends the edit, by any route, writes what was typed; a box made just now and left empty then goes again.
  useEffect(
    () => () => {
      write();
      settleFresh(session, id);
    },
    [write, session, id],
  );

  // The commands (bold, size, colour, link) reach the box through the window's state.
  useEffect(() => {
    const current = handle.current;
    if (current) ui.setText(current);
    return () => ui.setText(null);
  }, [ui, id]);

  // Where the caret goes as the box opens: where the click that opened it was, else at the end of the words. Read once for each box.
  const from = useMemo(() => session.state.editFrom, [session, id]);
  const element = findElement(session.slide.elements, id);
  const theme = state.deck.theme;
  const layout = session.slide.layout;
  const box = useMemo(() => (element ? boxOf(theme, layout, element) : null), [element, theme, layout]);
  if (!element || !box || (element.type !== "text" && element.type !== "shape")) return null;

  const slot = placeholderOf(theme, layout, element);
  const words = wordsOf(element) ?? NO_WORDS;
  // A box that resizes to fit its words is as tall as they are while they are typed.
  const height = element.type === "text" && natural !== null && words.fit === "resize" ? Math.max(natural, 1) : box.h;
  grown.current = { natural: element.type === "text" ? natural : null, height: box.h };
  const area = element.type === "shape" ? textRect(element.shape, box.w, box.h, element.style?.radius) : { x: 0, y: 0, w: box.w, h: height };
  const valign = words.valign ?? slot?.valign ?? (element.type === "shape" ? "middle" : "top");
  const open = (mode: LinkCard["mode"], href: string | null): void => {
    const where = handle.current?.caretRect();
    if (!where) return;
    setLink({ mode, href, anchor: where, hasSelection: (handle.current?.selectedText() ?? "") !== "" });
  };
  const noticed = (format: FormatState): void => {
    // A caret that comes to rest in a link shows where it goes; one that leaves it, or the words changing, takes the card away.
    const inLink = typeof format.link === "string" && (handle.current?.selectedText() ?? "") === "";
    if (inLink) {
      if (!link || link.mode === "card") open("card", format.link as string);
    } else if (link?.mode === "card") setLink(null);
  };

  return (
    <div className={`ks-text-layer${height !== box.h ? " is-resizing" : ""}`} style={frameStyle({ ...box, h: height }, element, 1)} data-editing={id}>
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}>
        <Upright flipH={element.flipH} flipV={element.flipV}>
          <TextEditor
            handleRef={handle}
            theme={theme}
            text={words}
            baseStyle={slot?.style ?? "body"}
            width={area.w}
            height={area.h}
            insets={words.insets ?? DEFAULT_INSETS}
            valign={valign}
            defaultList={element.type === "text" ? (slot?.list ?? null) : null}
            autoFocus={from ?? "end"}
            onChange={(text) => {
              pending.current = text;
              if (link?.mode === "card") setLink(null);
            }}
            onDone={(text) => {
              pending.current = text;
              write();
              session.stopEditing();
            }}
            onFormat={noticed}
            onNaturalHeight={(needed) => setNatural((now) => (now !== null && Math.abs(now - needed) < 0.5 ? now : needed))}
            onLinkRequest={(current) => open("edit", current)}
          />
        </Upright>
      </div>
      {link && handle.current
        ? createPortal(
            <LinkPopover
              handle={handle.current}
              mode={link.mode}
              href={link.href}
              anchor={link.anchor}
              hasSelection={link.hasSelection}
              onClose={() => setLink(null)}
              onEdit={() => open("edit", link.href)}
              actions={linkActions(session)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
