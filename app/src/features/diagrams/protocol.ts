// The editor's embed protocol (draw.io, JSON): the messages the app sends to
// the frame and reads from it, as typed values. Written against the pinned
// release's documented embed mode (https://www.drawio.com/doc/faq/embed-mode)
// and exercised against a stub that speaks it; the shapes the real editor
// sends beyond what is read here are ignored.
//
// With `proto=json` every message is a JSON string. The editor says
// `configure` (if asked to), then `init`; the host answers `load`; changes
// come as `autosave`; `export` asks for a picture and its answer is an
// `export` event whose `data` is a data URI.

/** The URL parameters of the frame, apart from the theme and language. */
const EMBED = "embed=1&proto=json&configure=1&offline=1&spin=1&libraries=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0";

export type EditorUi = "kennedy" | "min";

/** The frame's address under `base` (the editor's own `index.html`). `offline` keeps it from any network service. */
export function frameUrl(base: string, options: { dark: boolean; ui?: EditorUi; lang?: string }): string {
  const ui = options.ui ?? "kennedy";
  return `${base}?${EMBED}&dark=${options.dark ? 1 : 0}&ui=${ui}&lang=${encodeURIComponent(options.lang ?? "en")}`;
}

/** What the editor tells the app. Only what is read is typed; the rest is dropped. */
export type EditorEvent =
  | { event: "configure" }
  | { event: "init" }
  | { event: "load" }
  | { event: "autosave"; xml: string }
  | { event: "save"; xml: string; exit: boolean }
  | { event: "exit"; modified: boolean }
  | { event: "export"; format: string; data: string | null; xml: string | null }
  | { event: "openLink"; href: string; target: string | null }
  | { event: "status"; message: string; modified: boolean }
  | { event: "template"; xml: string | null; name: string | null };

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** One message from the editor, or null when it is not a message of the protocol. */
export function parseEvent(data: unknown): EditorEvent | null {
  let message: unknown = data;
  if (typeof data === "string") {
    if (!data.startsWith("{")) return null;
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  const m = message as Record<string, unknown>;
  switch (m.event) {
    case "configure":
    case "init":
    case "load":
      return { event: m.event };
    case "autosave": {
      const xml = text(m.xml);
      return xml === null ? null : { event: "autosave", xml };
    }
    case "save": {
      const xml = text(m.xml);
      return xml === null ? null : { event: "save", xml, exit: m.exit === true };
    }
    case "exit":
      return { event: "exit", modified: m.modified === true };
    case "export":
      return { event: "export", format: text(m.format) ?? "", data: text(m.data), xml: text(m.xml) };
    case "openLink": {
      const href = text(m.href);
      return href === null ? null : { event: "openLink", href, target: text(m.target) };
    }
    case "status":
      return { event: "status", message: text(m.message) ?? "", modified: m.modified === true };
    case "template":
      return { event: "template", xml: text(m.xml), name: text(m.name) };
    default:
      return null;
  }
}

/** What the app tells the editor. */
export type EditorAction =
  | { action: "configure"; config: Record<string, unknown> }
  | { action: "load"; xml: string; autosave: 0 | 1; title?: string; dark?: 0 | 1 }
  | { action: "export"; format: "xmlsvg" | "svg" | "png" | "xml"; embedImages?: boolean; border?: number; background?: string; scale?: number; transparent?: boolean; theme?: "light" | "dark" | "auto" }
  | { action: "merge"; xml: string }
  | { action: "status"; message: string; modified: boolean }
  | { action: "spinner"; show: boolean; message?: string }
  | { action: "template"; callback: boolean; enableRecent?: 0 | 1; enableSearch?: 0 | 1; enableCustomTemp?: 0 | 1; noExitOnCancel?: boolean };

/** The answer to `configure`: diagrams are written as plain XML (readable in a
 * diff and by agents), and a link in a diagram is handed to the app rather
 * than opened by the editor in a window of its own. */
export const configure = (): EditorAction => ({ action: "configure", config: { compressXml: false, suppressNewWindows: true } });

/** The answer to `init`: the diagram, saved as it changes unless it is only
 * being drawn again for its picture. */
export const load = (xml: string, dark: boolean, options: { title?: string; autosave?: boolean } = {}): EditorAction => ({
  action: "load",
  xml,
  autosave: options.autosave === false ? 0 : 1,
  dark: dark ? 1 : 0,
  ...(options.title ? { title: options.title } : {}),
});

/** Asks for the diagram's picture with the diagram inside it, which is what
 * is kept beside the source. Images are embedded and the picture has a white
 * ground of its own, so it stands alone in a page, a card, a slide or a viewer
 * that knows nothing of Kasten. `theme: "light"` is what makes it one picture:
 * left out, an editor in dark mode (Kasten opens it with `dark=1` in a dark window)
 * answers an SVG whose colours are `light-dark()` pairs, which would draw one way
 * on a dark system and another on a light one, and into a slide's PNG by the
 * system's mood. */
export const exportPicture = (): EditorAction => ({ action: "export", format: "xmlsvg", embedImages: true, border: 10, background: "#ffffff", theme: "light" });

/** Asks for a PNG at `scale` (a slide's picture, where SVG is not carried), on white. */
export const exportPng = (scale = 2): EditorAction => ({ action: "export", format: "png", scale, border: 10, background: "#ffffff" });

/** Asks for the editor's template dialog (a new diagram from a template). */
export const showTemplates = (): EditorAction => ({ action: "template", callback: true, enableRecent: 0, enableSearch: 1, enableCustomTemp: 0, noExitOnCancel: true });

/** The text an export's `data` URI holds: base64 or percent-encoded, as UTF-8. Null when it is not a data URI. */
export function textOfDataUri(data: string): string | null {
  const match = /^data:([^,]*?),(.*)$/s.exec(data);
  if (!match) return null;
  const [, head = "", body = ""] = match;
  try {
    if (/;base64$/i.test(head)) {
      const binary = atob(body);
      return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** The bytes an export's `data` URI holds (a PNG), or null. */
export function bytesOfDataUri(data: string): Uint8Array | null {
  const match = /^data:[^,]*?;base64,(.*)$/s.exec(data);
  if (!match) return null;
  try {
    return Uint8Array.from(atob(match[1] ?? ""), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Whether a message came from the frame itself: the very window of the
 * frame, and the origin the editor is served from. Everything else on the
 * window's message channel is not the editor's. `custom` origins of schemes a
 * web view does not give a tuple origin read as "null", so they are accepted
 * only for the editor's own custom scheme. */
export function fromFrame(event: { source: unknown; origin: string }, frame: Window | null | undefined, origin: string): boolean {
  if (!frame || event.source !== frame) return false;
  if (event.origin === origin) return true;
  return event.origin === "null" && !/^https?:/.test(origin);
}

/** The message as the editor is sent it. */
export const encode = (action: EditorAction): string => JSON.stringify(action);

/** A link in a diagram that the app opens in the system's browser: a web or mail address, nothing else. */
export function outsideLink(href: string): string | null {
  try {
    const url = new URL(href.trim());
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** A link in a diagram that names a page of the vault: `[[Page]]` or `[[Page#Heading|alias]]`, as it is typed in a page. */
export function pageLink(href: string): string | null {
  const match = /^\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(href.trim());
  return match?.[1]?.trim() || null;
}
