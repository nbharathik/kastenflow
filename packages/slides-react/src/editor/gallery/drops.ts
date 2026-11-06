// The slide as a place to drop on: an image dragged out of the drawer lands
// where it is let go, or fills an empty image slot of the layout if it is let
// go over one; pictures dragged in from the computer are kept and placed.

import { type DragEvent, type RefObject, useCallback, useRef } from "react";

import { hitAt, itemsOf } from "../canvas/geometry.ts";
import { insertImageFiles } from "../commands/insert.ts";
import type { HostImage } from "../host.ts";
import { insertComposite } from "../insert-composite.ts";
import type { EditorSession } from "../session/session.ts";
import { droppedImage, hasFileDrag, hasImageDrag, pictureFiles } from "./drag.ts";
import { droppedLink, hasLinkDrag } from "./link-drop.ts";
import { fillSlot, insertAt } from "./place.ts";
import "./gallery.css";

/** What the slide's stage listens for while something is dragged over it. */
export interface DropHandlers {
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
}

/** The empty image slot under a point of the slide, if there is one. */
function slotAt(session: EditorSession, point: { x: number; y: number }, zoom: number) {
  const id = hitAt(itemsOf(session), point, zoom);
  const element = id === null ? undefined : session.slide.elements.find((e) => e.id === id);
  return element?.type === "image" && element.src.trim() === "" ? element : undefined;
}

/** Handlers for the slide's page: `page` is the element the slide is drawn in, `zoom` how much it is scaled. */
export function useImageDrops(session: EditorSession, page: RefObject<HTMLElement | null>, zoom: RefObject<number>): DropHandlers {
  const hot = useRef<Element | null>(null);

  /** Shows where a drop would go: the slot it would fill, or the slide. */
  const mark = useCallback(
    (target: Element | null) => {
      if (hot.current === target) return;
      hot.current?.classList.remove("ks-drop-hot");
      hot.current = target;
      target?.classList.add("ks-drop-hot");
    },
    [],
  );

  const point = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const box = page.current?.getBoundingClientRect();
      const scale = zoom.current || 1;
      return { x: box ? (event.clientX - box.left) / scale : 0, y: box ? (event.clientY - box.top) / scale : 0 };
    },
    [page, zoom],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const image = hasImageDrag(event);
      if (!image && !hasFileDrag(event) && !hasLinkDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const slot = image ? slotAt(session, point(event), zoom.current || 1) : undefined;
      mark((slot && page.current?.querySelector(`[data-el="${slot.id}"]`)) || page.current);
    },
    [session, page, zoom, point, mark],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node) || !page.current?.contains(event.relatedTarget)) mark(null);
    },
    [page, mark],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      mark(null);
      const dragged = droppedImage(event);
      const files = pictureFiles(event.dataTransfer?.files ?? []);
      // A link let go on the slide is an embed there (a video's player for a video site).
      const link = !dragged && files.length === 0 ? droppedLink(event) : null;
      if (!dragged && files.length === 0 && link === null) return;
      event.preventDefault();
      const at = point(event);
      if (link !== null) {
        insertComposite(session, "embed", { address: link }, at);
        return;
      }
      if (dragged) {
        const image: HostImage = dragged;
        const slot = slotAt(session, at, zoom.current || 1);
        const frame = slot ? session.elements.boxOf(slot) : null;
        if (slot && frame) void fillSlot(session, slot.id, frame, image);
        else void insertAt(session, image, at);
        return;
      }
      void insertImageFiles({ session }, files, { source: "file", at });
    },
    [session, zoom, point, mark],
  );

  return { onDragOver, onDragLeave, onDrop };
}
