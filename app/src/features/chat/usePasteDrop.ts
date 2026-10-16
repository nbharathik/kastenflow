// Getting things into a message by pasting or dropping them on the box. A long
// paste, a picture or a file from the clipboard, and files dragged onto the box
// become attachments. The drag handlers cancel the event, so the window's guard
// (shell/file-drops.ts) does not import a dropped PDF into sources/ instead.

import { useState, type ClipboardEvent, type DragEvent } from "react";

import { useAttachments } from "./attach-store";
import { MAX_ATTACHMENTS, shouldAttachPaste } from "./attachments";
import { onlyPicture } from "./pick-files";

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

export function usePasteDrop(thread: string, enabled: boolean) {
  const [dragging, setDragging] = useState(false);

  return {
    /** Files are being dragged over the box. */
    dragging,
    /** For the box (the form). */
    drop: {
      onDragEnter(event: DragEvent) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragOver(event: DragEvent) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
        setDragging(true);
      },
      onDragLeave(event: DragEvent) {
        // Moving over a part of the box is not leaving it.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      },
      onDrop(event: DragEvent) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (enabled && files.length > 0) void useAttachments.getState().add(thread, files);
      },
    },
    /** For the text box. */
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const data = event.clipboardData;
      if (!enabled || !data) return;
      const files = Array.from(data.files);
      // A picture copied from a page comes with its HTML; a paste of text from
      // Office or a web page comes with a picture of it too, and is text.
      const html = data.getData("text/html");
      if (files.length > 0 && (!html || onlyPicture(html))) {
        event.preventDefault();
        void useAttachments.getState().add(thread, files);
        return;
      }
      const text = data.getData("text/plain");
      const room = (useAttachments.getState().byThread[thread] ?? []).filter((a) => a.state !== "error").length < MAX_ATTACHMENTS;
      if (text && room && shouldAttachPaste(text)) {
        event.preventDefault();
        void useAttachments.getState().addText(thread, text);
      }
    },
  };
}
