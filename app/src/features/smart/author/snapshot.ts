// What a smart page last read, kept while its frame is showing, so a copy of
// the page for sharing ("Export as HTML file") can carry the data of the
// moment: the answers the bridge gave to the page's reads and watches, each
// under the request that asked for it. Reads only: a write is never recorded.
// Kept in memory, per page, and bounded.

/** One answer the page was given. */
export interface SnapshotEntry {
  key: string;
  kind: string;
  args: unknown;
  value: unknown;
}

/** The most requests kept for one page, and the most text they may hold. */
export const MAX_ENTRIES = 200;
export const MAX_BYTES = 4 * 1024 * 1024;

/** The most pages whose answers are kept at once; the one used least recently is let go first. */
export const MAX_PAGES = 8;

interface Book {
  entries: Map<string, SnapshotEntry>;
  sizes: Map<string, number>;
  bytes: number;
}

const books = new Map<string, Book>();

/** Pages whose frame has been showing since the app began: only for these is a copy true to what the page shows. */
const shown = new Set<string>();

/** An object as text with its keys in order, so the same request is the same key however its keys were written. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The key a request is kept under. A watch is the query it watches. */
export const keyOf = (kind: string, args: unknown): string => `${kind}|${args === undefined ? "" : stable(args)}`;

/** Keeps `value` as the answer to the request `kind` / `args` of the page at `page`. */
export function record(page: string, kind: string, args: unknown, value: unknown): void {
  const text = JSON.stringify(value);
  // An answer that alone is more than a copy may carry is not kept (and does not push the others out).
  if (text === undefined || text.length > MAX_BYTES) return;
  // The page used last is the newest; past the most pages, the least recently used goes with its answers.
  let book = books.get(page);
  if (book) books.delete(page);
  else book = { entries: new Map(), sizes: new Map(), bytes: 0 };
  books.set(page, book);
  shown.add(page);
  for (const old of [...books.keys()]) {
    if (books.size <= MAX_PAGES) break;
    books.delete(old);
    shown.delete(old);
  }
  const key = keyOf(kind, args);
  book.bytes -= book.sizes.get(key) ?? 0;
  book.entries.delete(key);
  book.entries.set(key, { key, kind, args, value });
  book.sizes.set(key, text.length);
  book.bytes += text.length;
  // The oldest requests go first when the book is too long or too heavy.
  for (const old of book.entries.keys()) {
    if (book.entries.size <= MAX_ENTRIES && book.bytes <= MAX_BYTES) break;
    if (old === key) continue;
    book.bytes -= book.sizes.get(old) ?? 0;
    book.sizes.delete(old);
    book.entries.delete(old);
  }
}

/** What the page at `page` has been given, oldest first. */
export function snapshotOf(page: string): SnapshotEntry[] {
  return [...(books.get(page)?.entries.values() ?? [])];
}

/** The recorder the bridge host is given for the page at `page`. */
export const recorderFor = (page: string) => {
  shown.add(page);
  return (kind: string, args: unknown, value: unknown) => record(page, kind, args, value);
};

/** Whether the page's frame has been showing, so its snapshot says what the page read. */
export const wasShown = (page: string): boolean => shown.has(page);

export function forgetSnapshot(page?: string): void {
  if (page === undefined) {
    books.clear();
    shown.clear();
  } else {
    books.delete(page);
    shown.delete(page);
  }
}
