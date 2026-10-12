import "./diagrams.css";

import { useEffect, useRef } from "react";

import { openUrl } from "../../lib/api";
import { registerFlusher } from "../workspace/page/open-page";
import { useWorkspace } from "../workspace/store";
import { editorPage, originOf, useDiagramEditor } from "./editor";
import { useDiagramHost } from "./host-store";
import { encode, frameUrl, fromFrame, outsideLink, pageLink, parseEvent, type EditorUi } from "./protocol";
import { DrawioSession, type EditorStatus } from "./session";
import { useAppDark } from "./useAppDark";

/** The sandbox of the editor's frame: its own scripts, its own origin, and what an editor needs of a window. No top navigation, and no way to Kasten's commands. */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

export interface FrameProps {
  /** The diagram as it was read: its file, source and the hash a save brings back. */
  file: { path: string; xml: string; hash: string };
  /** `render`: drawn again off screen for its picture, then done. `png`: drawn once off screen as a PNG for `onPng`. */
  mode?: "edit" | "render" | "png";
  /** Png mode: how many times its size (2). */
  scale?: number;
  onPng?(bytes: Uint8Array | null): void;
  ui?: EditorUi;
  /** Kept off screen, out of the tab order and away from screen readers. */
  hidden?: boolean;
  title: string;
  onSession?(session: DrawioSession | null): void;
  onStatus?(status: EditorStatus): void;
  onMoved?(path: string): void;
  onDone?(ok: boolean): void;
}

/** A link in a diagram: a web or mail address opens in the system's browser, a `[[Page]]` opens that page; anything else does nothing. */
export function followLink(href: string): void {
  const outside = outsideLink(href);
  if (outside) return void openUrl(outside);
  const page = pageLink(href);
  if (page) void useWorkspace.getState().openTitle(page);
}

/** The diagram editor in its frame, talking the embed protocol through a session that keeps the diagram saved. The editor must be installed (`editorPage`). */
export function DrawioFrame({ file, mode = "edit", scale, ui, hidden, title, onSession, onStatus, onMoved, onDone, onPng }: FrameProps) {
  const client = useWorkspace((s) => s.client);
  const installed = useDiagramEditor((s) => s.info?.installed ?? false);
  const dark = useAppDark();
  const frame = useRef<HTMLIFrameElement>(null);
  // The frame takes the theme it opens in; a change of theme shows when it is next opened.
  const theme = useRef(dark);
  const page = installed ? editorPage() : null;
  const callbacks = useRef({ onSession, onStatus, onMoved, onDone, onPng });
  callbacks.current = { onSession, onStatus, onMoved, onDone, onPng };
  // What the conversation begins with, read when it starts.
  const start = useRef(file);
  start.current = file;

  useEffect(() => {
    if (!page || !client) return;
    const origin = originOf(page);
    // A custom scheme's origin may read as "null": the frame's own window is the check there.
    const target = /^https?:/.test(origin) ? origin : "*";
    const opened = start.current;
    const session = new DrawioSession({
      path: opened.path,
      xml: opened.xml,
      hash: opened.hash,
      dark: theme.current,
      client,
      mode,
      ...(scale === undefined ? {} : { scale }),
      post: (action) => frame.current?.contentWindow?.postMessage(encode(action), target),
      onStatus: (status) => callbacks.current.onStatus?.(status),
      onMoved: (path) => callbacks.current.onMoved?.(path),
      onLink: followLink,
      onDone: (ok) => callbacks.current.onDone?.(ok),
      onPng: (bytes) => callbacks.current.onPng?.(bytes),
    });
    callbacks.current.onSession?.(session);
    // While an editor has it open, its pictures are the editor's to keep: nothing draws them again meanwhile.
    if (mode === "edit") useDiagramHost.getState().setEditing(opened.path, true);
    const onMessage = (event: MessageEvent) => {
      if (!fromFrame(event, frame.current?.contentWindow, origin)) return;
      session.handle(parseEvent(event.data));
    };
    window.addEventListener("message", onMessage);
    const forget = mode === "edit" ? registerFlusher(() => session.flush()) : () => {};
    return () => {
      window.removeEventListener("message", onMessage);
      forget();
      callbacks.current.onSession?.(null);
      if (mode === "edit") useDiagramHost.getState().setEditing(opened.path, false);
      // What is waiting is written; there is no frame left to draw the picture.
      session.closing();
      void session.flush().finally(() => session.dispose());
    };
    // Only a different file (or the editor arriving) starts another conversation; saving the same one does not.
  }, [page, client, mode, file.path]);

  if (!page) return null;
  return (
    <iframe
      ref={frame}
      src={frameUrl(page, { dark: theme.current, ui, lang: "en" })}
      title={title}
      sandbox={FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      className={hidden ? "kasten-diagram-hidden" : "kasten-diagram-frame"}
      {...(hidden ? { "aria-hidden": true, tabIndex: -1 } : {})}
    />
  );
}
