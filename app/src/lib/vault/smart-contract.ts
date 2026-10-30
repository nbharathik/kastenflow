// Smart pages: the shared types, limits and URL helpers. They mirror, field for
// field, the Rust types in crates/kasten-core/src/smart/ (camelCase on the wire).
// Import them from "./smart-types", which also holds the message table.

/** The folder beside a page `<name>.md` is `<name>.smart`. */
export const SMART_DIR_SUFFIX = ".smart";
export const MANIFEST_FILE = "smart.yaml";
export const INDEX_FILE = "index.html";
/** The `layout:` value of a smart page. */
export const SMART_LAYOUT = "smart";
export const MANIFEST_VERSION = 1;
export const DEFAULT_KIT = "1";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["html", "js", "css", "json", "svg", "png", "webp", "jpg", "txt"] as const;

export const MAX_CALLS_PER_SECOND = 50;
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
export const WATCH_DEBOUNCE_MS = 300;
export const MAX_ERROR_RECORDS = 50;
export const MAX_BLOCK_HEIGHT_PX = 1200;
export const MAX_LIVE_FRAMES = 4;
export const MAX_QUERY_LIMIT = 10_000;

/**
 * What a smart frame may load: its own files only, no network. `base-uri` and
 * `form-action` do not fall back to `default-src`, so they are named: a `<base>`
 * cannot re-point the page's relative addresses and no form can post anywhere.
 * Kept in step with `CSP` of `kasten_core::smart`.
 */
export const SMART_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** The policy for a page, with web pictures when the person allowed them. */
export function smartCsp(webImages: boolean): string {
  return webImages ? SMART_CSP.replace("img-src 'self' data: blob:", "img-src 'self' data: blob: https:") : SMART_CSP;
}

const segments = (path: string) =>
  path
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

/**
 * `smart://kit/<kit-version>/<file>`: the kit every smart page may load, as a page's own markup names it.
 * The app rewrites it to the address the frame was reached at, which carries the frame's secret.
 */
export function kitUrl(version: string, file: string): string {
  return `smart://kit/${encodeURIComponent(version)}/${segments(file)}`;
}

/**
 * Whether `rel` (a path inside the folder, with `/`) is one the folder may hold and
 * the protocol may serve: relative, no `..`, no empty parts, an allowed ending, or
 * the manifest at the top.
 */
export function isAllowedPath(rel: string): boolean {
  if (rel === MANIFEST_FILE) return true;
  if (rel === "" || /[\\:\0]/.test(rel)) return false;
  // Hidden names (a part starting with a dot) are never part of a folder; this also covers `.` and `..`.
  if (rel.split("/").some((part) => part === "" || part.startsWith("."))) return false;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(name.slice(dot + 1).toLowerCase());
}

/** The folder beside a page: `a/b.md` gives `a/b.smart`; null for a path that is not a page. */
export function sidecarDir(pagePath: string): string | null {
  if (!pagePath.endsWith(".md")) return null;
  const stem = pagePath.slice(0, -3);
  if (stem.slice(stem.lastIndexOf("/") + 1) === "") return null;
  return stem + SMART_DIR_SUFFIX;
}

// ---- manifest (smart.yaml) ----

export const FILTER_OPS = ["is", "is_not", "contains", "empty", "not_empty", "before", "after"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface SmartFilter {
  key: string;
  /** `is` when left out. */
  op?: FilterOp;
  value?: unknown;
}

export interface SmartSort {
  key: string;
  /** `asc` when left out. */
  dir?: "asc" | "desc";
}

/** The notes tagged `tag`, filtered, sorted and capped (a named query, `query`, `watch`). */
export interface QuerySpec {
  tag: string;
  filter?: SmartFilter[];
  sort?: SmartSort[];
  limit?: number;
}

/** Keys this version does not know are kept as they were. */
export type WithExtra<T> = T & { [key: string]: unknown };

export interface SmartView {
  title?: string;
  /** An HTML file inside the folder, when the view is not the main page. */
  entry?: string;
}

export interface SmartSize {
  height?: number;
  maxHeight?: number;
}

export type SmartManifest = WithExtra<{
  version: number;
  title: string;
  /** The kit version the page was written for. */
  kit: string;
  queries?: Record<string, WithExtra<QuerySpec>>;
  views?: Record<string, WithExtra<SmartView>>;
  size?: WithExtra<SmartSize>;
}>;

// ---- bridge ----

export type SmartTheme = "light" | "dark";
export const ERROR_KINDS = ["error", "unhandledrejection", "console.error"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** An error the kit caught, as it sends it (the app adds the time). */
export interface ErrorReport {
  kind: ErrorKind;
  message: string;
  source?: string;
  line?: number;
}

/** One entry of a page's error log. */
export interface ErrorRecord extends ErrorReport {
  /** When it happened (ISO time). */
  time: string;
}

/** The file `.kasten/cache/smart/<id>.log.json`. */
export interface ErrorLog {
  records: ErrorRecord[];
}

export type Props = Record<string, unknown>;

/** What a page asks the app to do. `args` is left out for `project` and `theme`. */
export type BridgeCall =
  | { kind: "query"; args: QuerySpec }
  | { kind: "list"; args: { project?: string; tag?: string; type?: string } }
  | { kind: "read"; args: { id: string } }
  | { kind: "search"; args: { q: string; limit?: number } }
  | { kind: "journal"; args: { date: string } }
  | { kind: "project" }
  | { kind: "tasks"; args: { project?: string; tag?: string; done?: boolean } }
  | { kind: "board"; args: { path: string } }
  | { kind: "watch"; args: { watchId: string; query: QuerySpec } }
  | { kind: "unwatch"; args: { watchId: string } }
  | { kind: "open"; args: { target: string } }
  | { kind: "theme" }
  | { kind: "resize"; args: { px: number } }
  | { kind: "log"; args: { args: unknown[] } }
  | { kind: "report"; args: ErrorReport }
  | { kind: "update"; args: { id: string; props: Props } }
  | { kind: "addTags"; args: { id: string; tags: string[] } }
  | { kind: "createNote"; args: { title: string; tags?: string[]; props?: Props; body?: string; project?: string } }
  | { kind: "append"; args: { id: string; md: string } }
  | { kind: "toggleTodo"; args: { id: string; index: number } };

export type BridgeKind = BridgeCall["kind"];
export type BridgeRequest = BridgeCall & { id: number };

export const WRITE_KINDS: readonly BridgeKind[] = ["update", "addTags", "createNote", "append", "toggleTodo"];

/** Whether the call changes the vault (and so runs as an agent actor). */
export function isWriteCall(call: { kind: BridgeKind }): boolean {
  return WRITE_KINDS.includes(call.kind);
}

export const BRIDGE_ERROR_CODES = ["rate_limited", "too_large", "refused", "bad_request", "not_found"] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export interface BridgeError {
  code: BridgeErrorCode;
  /** One plain sentence. */
  message: string;
}

export function bridgeError(code: BridgeErrorCode, message: string): BridgeError {
  return { code, message };
}

/** The answer to one request. `value` is left out when there is nothing to say. */
export type BridgeAnswer = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: BridgeError };

/** Sent to the page without being asked. */
export type BridgeEvent =
  | { event: "init"; pageId: string; theme: SmartTheme; view?: string }
  | { event: "watch"; watchId: string; value: unknown }
  | { event: "theme"; theme: SmartTheme };
