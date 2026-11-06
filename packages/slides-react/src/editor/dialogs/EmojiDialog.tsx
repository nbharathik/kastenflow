import { type JSX, type KeyboardEvent, useRef, useState } from "react";

import type { Element } from "@kasten-slides/wasm";

import { findEmoji } from "../../text/emoji-groups.ts";
import { insertPlaced } from "../insert-composite.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import type { DialogProps } from "./types.ts";
import "./emoji.css";

/** How big the text box is that an emoji becomes when no words are being typed, and how large the picture is drawn in it. */
const BOX = { w: 120, h: 96 };
const POINTS = 56;

const textBoxOf = (glyph: string): Element =>
  ({ type: "text", id: "", x: 0, y: 0, ...BOX, text: { paragraphs: [{ runs: [{ t: glyph, size: POINTS }], align: "center" }], valign: "middle" } }) as Element;

/**
 * A searchable grid of the emoji the `:name:` shortcodes know, by category. A pick goes into the words being typed, at the caret;
 * when no words are being typed it is put on the slide as a text box, large, where there is room.
 */
export function EmojiDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const categories = findEmoji(search);

  const pick = (glyph: string) => {
    const editor = ui.state.text;
    if (editor) editor.insertText(glyph);
    else insertPlaced(session, textBoxOf(glyph), BOX);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown"].includes(event.key)) return;
    const field = root.current?.querySelector<HTMLInputElement>(".ks-em-search");
    const cells = [...(root.current?.querySelectorAll<HTMLElement>(".ks-em-cell") ?? [])];
    if (document.activeElement === field) {
      // The arrows move the caret in the box; Down leaves it for the first picture.
      if (event.key !== "ArrowDown" || !cells[0]) return;
      event.preventDefault();
      cells[0].focus();
      return;
    }
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    cells[event.key === "ArrowLeft" ? at - 1 : at + 1]?.focus();
  };

  return (
    <Dialog title="Emoji" width={360} onClose={onClose} footer={<TextButton onClick={onClose}>Cancel</TextButton>}>
      {/* The words in an open text box stay selected while this is used. */}
      <div ref={root} className="ks-em" data-ks-keep-focus="" onKeyDown={onKeyDown}>
        <input
          className="ks-input ks-em-search"
          type="search"
          data-autofocus=""
          aria-label="Search emoji"
          placeholder="Search by name, such as rocket"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="ks-em-scroll">
          {categories.length === 0 ? <p className="ks-em-none">No emoji has that name.</p> : null}
          {categories.map((category) => (
            <section key={category.title} className="ks-em-group">
              <h3 className="ks-em-title">{category.title}</h3>
              <div className="ks-em-grid" role="group" aria-label={category.title}>
                {category.items.map((item) => (
                  <button key={item.glyph} type="button" className="ks-em-cell" aria-label={item.label} title={item.names.map((name) => `:${name}:`).join(" ")} onClick={() => pick(item.glyph)}>
                    {item.glyph}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="ks-em-hint">{ui.state.text ? "It goes in at the caret." : "It goes on the slide as a text box."}</p>
      </div>
    </Dialog>
  );
}
