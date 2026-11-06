// The journal of unsaved edits. While a deck has edits that are not saved, the editor keeps its text here, away from the deck's file and
// away from the vault, so that a crash or a closed window does not lose them. When the deck is saved the journal is emptied; when the deck
// is opened and the journal still has something, the editor offers to recover it.

/** The edits not yet saved, as the whole text of the deck they made. */
export interface JournalEntry {
  /** The deck as the editor had it. */
  text: string;
  /** When it was written, in milliseconds since 1970. */
  time: number;
  /** Names the text of the file the edits were made on (see `hashText`): the file may have changed since. */
  base: string;
}

/** Where the journal is kept. A host may keep it in the app's cache folder; the default is the page's IndexedDB. */
export interface RecoveryJournal {
  read(key: string): Promise<JournalEntry | null>;
  write(key: string, entry: JournalEntry): Promise<void>;
  /** The deck was saved: nothing unsaved is left. */
  clear(key: string): Promise<void>;
  /** The person turned the recovery down: the entry is kept aside, replacing any put aside before, and is no longer offered. It is never part of the vault. */
  keepAside(key: string): Promise<void>;
  /** The entry put aside last for the deck, so that a decision can be taken back. */
  readAside(key: string): Promise<JournalEntry | null>;
}

/** A short name for a text: the same text is always the same name. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 31) + c) >>> 0;
  }
  return `${a.toString(16)}-${b.toString(16)}-${text.length.toString(16)}`;
}

/** A journal that lives in memory: for tests, and for a host that wants none kept past the page. */
export function memoryJournal(): RecoveryJournal & { entries: Map<string, JournalEntry>; aside: Map<string, JournalEntry> } {
  const entries = new Map<string, JournalEntry>();
  const aside = new Map<string, JournalEntry>();
  return {
    entries,
    aside,
    read: async (key) => entries.get(key) ?? null,
    write: async (key, entry) => void entries.set(key, entry),
    clear: async (key) => void entries.delete(key),
    keepAside: async (key) => {
      const entry = entries.get(key);
      if (entry) aside.set(key, entry);
      entries.delete(key);
    },
    readAside: async (key) => aside.get(key) ?? null,
  };
}

const DATABASE = "kasten-slides-recovery";
const CURRENT = "unsaved";
const ASIDE = "put-aside";

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CURRENT);
      request.result.createObjectStore(ASIDE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The recovery store could not be opened."));
  });
}

function request<T>(database: IDBDatabase, store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const made = run(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(made ? (made.result as T) : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error("The recovery store failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The recovery store failed."));
  });
}

/** The journal in the page's IndexedDB; none where the page has no IndexedDB. Every call answers quietly when the store cannot be used: recovery is a help, never a reason to fail. */
export function indexedDbJournal(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): RecoveryJournal | null {
  if (!factory) return null;
  let database: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> => (database ??= open(factory).catch(() => null));
  const get = async (store: string, key: string): Promise<JournalEntry | null> => {
    const d = await db();
    if (!d) return null;
    return ((await request<JournalEntry | undefined>(d, store, "readonly", (s) => s.get(key)).catch(() => undefined)) ?? null) as JournalEntry | null;
  };
  const put = async (store: string, key: string, entry: JournalEntry): Promise<void> => {
    const d = await db();
    if (d) await request(d, store, "readwrite", (s) => void s.put(entry, key)).catch(() => undefined);
  };
  const remove = async (store: string, key: string): Promise<void> => {
    const d = await db();
    if (d) await request(d, store, "readwrite", (s) => void s.delete(key)).catch(() => undefined);
  };
  return {
    read: (key) => get(CURRENT, key),
    write: (key, entry) => put(CURRENT, key, entry),
    clear: (key) => remove(CURRENT, key),
    async keepAside(key) {
      const entry = await get(CURRENT, key);
      if (entry) await put(ASIDE, key, entry);
      await remove(CURRENT, key);
    },
    readAside: (key) => get(ASIDE, key),
  };
}
