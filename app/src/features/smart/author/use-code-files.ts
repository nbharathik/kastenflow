// The state of the code editor: the files of a smart page's folder, the ones
// opened, and saving. A change is saved 500 ms after the last keystroke,
// against the hash the file was read with; if the file changed on disk meanwhile
// the save is refused and the editor offers a choice ("Keep mine" or "Use the
// file on disk") instead of merging. Each save that lands tells the owner, so
// the page's frame can load again.

import { useCallback, useEffect, useRef, useState } from "react";

import { registerFlusher } from "../../workspace/page/open-page";
import { type AuthorBackend, type Listing, asWriteRefused, sentence } from "./backend";
import { RESTORED_LINE } from "./words";

/** How long after the last keystroke a file is saved. */
export const SAVE_DELAY_MS = 500;

/** The file as it is on disk now, when it is not what the editor read. */
export interface Conflict {
  disk: string;
  diskHash: string;
  /** The file was taken away: "Keep mine" makes it again; there is no file on disk to use. */
  gone?: boolean;
}

export interface OpenFile {
  path: string;
  text: string;
  /** The hash of the file as the editor last read or wrote it. */
  hash: string;
  dirty: boolean;
  saving: boolean;
  /** A picture or other file the editor cannot show as text. */
  binary: boolean;
  conflict: Conflict | null;
  /** One plain sentence when the last save did not work. */
  problem: string | null;
  /** Bumps when the text was replaced from outside the editor (the disk's file was chosen), so the editor loads it. */
  revision: number;
}

export interface CodeFiles {
  listing: Listing | null;
  /** The sentence for a folder that could not be read. */
  failed: string | null;
  files: Readonly<Record<string, OpenFile>>;
  current: string | null;
  /** Some file has changes not saved yet. */
  unsaved: boolean;
  open(path: string): void;
  edit(path: string, text: string): void;
  /** Saves everything waiting now. */
  flush(): Promise<void>;
  save(path: string): Promise<void>;
  keepMine(path: string): Promise<void>;
  /** Drops the editor's text for the file on disk. */
  takeDisk(path: string): void;
  create(name: string): Promise<string | null>;
  remove(path: string): Promise<string | null>;
  refresh(): Promise<void>;
}

const INDEX = "index.html";

/**
 * Text that could not be saved when the editor was left (the file changed on
 * disk, a write was refused), with the hash it was typed over. It is kept for
 * this session, so opening the file again gives the typing back instead of
 * losing it. A few files at most.
 */
const unsaved = new Map<string, { text: string; hash: string }>();
const MAX_UNSAVED = 20;
const unsavedKey = (page: string, path: string) => `${page}\u0000${path}`;

function stash(page: string, file: OpenFile | undefined): void {
  if (!file) return;
  const key = unsavedKey(page, file.path);
  unsaved.delete(key);
  if (!file.dirty || file.binary || file.saving) return;
  unsaved.set(key, { text: file.text, hash: file.hash });
  for (const old of unsaved.keys()) {
    if (unsaved.size <= MAX_UNSAVED) break;
    unsaved.delete(old);
  }
}

/** `page`'s files for the editor. `onSaved` is called after each save that landed. */
export function useCodeFiles(page: string, backend: AuthorBackend, onSaved: () => void): CodeFiles {
  const [listing, setListing] = useState<Listing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [, bump] = useState(0);
  const store = useRef<Record<string, OpenFile>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const live = useRef(true);

  const touch = useCallback(() => {
    if (live.current) bump((n) => n + 1);
  }, []);
  const put = useCallback(
    (path: string, change: Partial<OpenFile>) => {
      const was = store.current[path];
      if (!was) return;
      store.current = { ...store.current, [path]: { ...was, ...change } };
      touch();
    },
    [touch],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await backend.files(page);
      if (!live.current) return;
      setListing(next);
      setFailed(null);
    } catch (err) {
      if (live.current) setFailed(sentence(err));
    }
  }, [backend, page]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);

  const load = useCallback(
    async (path: string) => {
      if (store.current[path]) return;
      try {
        const read = await backend.read(page, path);
        if (!live.current || store.current[path]) return;
        // Typing that could not be saved when the editor was last left is given back, to be saved over the
        // hash it was typed on (so a file that changed since is a conflict, never overwritten).
        const kept = unsaved.get(unsavedKey(page, path));
        unsaved.delete(unsavedKey(page, path));
        const back = kept !== undefined && read.text !== null && kept.text !== read.text;
        store.current = {
          ...store.current,
          [path]: {
            path,
            text: back ? kept.text : (read.text ?? ""),
            hash: back ? kept.hash : read.hash,
            dirty: back,
            saving: false,
            binary: read.text === null,
            conflict: null,
            problem: back ? RESTORED_LINE : null,
            revision: 0,
          },
        };
        touch();
      } catch (err) {
        if (!live.current) return;
        store.current = {
          ...store.current,
          [path]: { path, text: "", hash: "", dirty: false, saving: false, binary: true, conflict: null, problem: sentence(err), revision: 0 },
        };
        touch();
      }
    },
    [backend, page, touch],
  );

  const open = useCallback(
    (path: string) => {
      setCurrent(path);
      void load(path);
    },
    [load],
  );

  // The first file shown is the page's own.
  useEffect(() => {
    if (current === null && listing?.exists) open(listing.files.some((f) => f.path === INDEX) ? INDEX : (listing.files.find((f) => f.allowed)?.path ?? INDEX));
  }, [current, listing, open]);

  /** The saves on their way, so asking again waits for the one that is running. */
  const running = useRef(new Map<string, Promise<void>>());

  const save = useCallback(
    (path: string): Promise<void> => {
      const timer = timers.current.get(path);
      if (timer !== undefined) clearTimeout(timer);
      timers.current.delete(path);
      // One save at a time for a file; what is typed meanwhile is saved by the same run, before it ends
      // (also when the editor was left meanwhile: nothing typed is dropped on the way out).
      const busy = running.current.get(path);
      if (busy) return busy;
      const run = (async () => {
        for (;;) {
          const file = store.current[path];
          if (!file || file.binary || !file.dirty || file.conflict) return;
          const sent = file.text;
          put(path, { saving: true, problem: null });
          try {
            const done = await backend.write(page, path, sent, file.hash);
            const now = store.current[path];
            if (!now) return;
            put(path, { saving: false, hash: done.hash, dirty: now.text !== sent, problem: null });
            if (live.current) saved.current();
          } catch (err) {
            const refused = asWriteRefused(err);
            if (refused.code === "gone") {
              // Written against "" the file is made again; nothing on disk to take instead.
              put(path, { saving: false, conflict: { disk: "", diskHash: "", gone: true } });
            } else if (refused.code === "conflict") {
              try {
                const disk = await backend.read(page, path);
                put(path, { saving: false, conflict: { disk: disk.text ?? "", diskHash: disk.hash } });
              } catch (readErr) {
                put(path, { saving: false, problem: sentence(readErr) });
              }
            } else {
              put(path, { saving: false, problem: refused.message });
            }
            return;
          }
        }
      })().finally(() => {
        running.current.delete(path);
        if (live.current) void refresh();
      });
      running.current.set(path, run);
      return run;
    },
    [backend, page, put, refresh],
  );

  const edit = useCallback(
    (path: string, text: string) => {
      const file = store.current[path];
      if (!file || file.binary || file.text === text) return;
      put(path, { text, dirty: true, problem: null });
      const old = timers.current.get(path);
      if (old !== undefined) clearTimeout(old);
      timers.current.set(
        path,
        setTimeout(() => void save(path), SAVE_DELAY_MS),
      );
    },
    [put, save],
  );

  const flush = useCallback(async () => {
    await Promise.all(Object.keys(store.current).map((path) => save(path)));
  }, [save]);

  // Leaving the editor saves what is waiting. What cannot be saved (the file changed on disk, a refused
  // write) is kept for this session and comes back when the file is opened again.
  useEffect(() => {
    const files = store;
    const leave = () => {
      for (const path of Object.keys(files.current)) void save(path).then(() => stash(page, files.current[path]));
    };
    // The window closing saves what was typed in the last half second; so do the app's own moments of
    // writing (a tab left, a note moved).
    window.addEventListener("pagehide", leave);
    const forget = registerFlusher(flush);
    return () => {
      window.removeEventListener("pagehide", leave);
      forget();
      leave();
    };
  }, [save, flush, page]);

  const keepMine = useCallback(
    async (path: string) => {
      const file = store.current[path];
      if (!file?.conflict) return;
      // The file on disk is what this save is written over.
      put(path, { hash: file.conflict.diskHash, conflict: null });
      await save(path);
    },
    [put, save],
  );

  const takeDisk = useCallback(
    (path: string) => {
      const file = store.current[path];
      if (!file?.conflict) return;
      put(path, { text: file.conflict.disk, hash: file.conflict.diskHash, conflict: null, dirty: false, problem: null, revision: file.revision + 1 });
      saved.current();
    },
    [put],
  );

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      const path = name.trim();
      if (!path) return "Give the file a name, such as style.css.";
      try {
        await backend.write(page, path, "", "");
      } catch (err) {
        const said = asWriteRefused(err).message;
        // The app's words for "write it against the hash you read" mean nothing here.
        return /already there/.test(said) ? `${path} is already there. Pick another name.` : said;
      }
      await refresh();
      store.current = { ...store.current, [path]: { path, text: "", hash: "", dirty: false, saving: false, binary: false, conflict: null, problem: null, revision: 0 } };
      try {
        const read = await backend.read(page, path);
        store.current = { ...store.current, [path]: { ...store.current[path]!, hash: read.hash } };
      } catch {
        // The first save finds the hash out.
      }
      setCurrent(path);
      touch();
      if (live.current) saved.current();
      return null;
    },
    [backend, page, refresh, touch],
  );

  const remove = useCallback(
    async (path: string): Promise<string | null> => {
      const timer = timers.current.get(path);
      if (timer !== undefined) clearTimeout(timer);
      timers.current.delete(path);
      try {
        await backend.remove(page, path);
      } catch (err) {
        return sentence(err);
      }
      unsaved.delete(unsavedKey(page, path));
      const { [path]: _gone, ...rest } = store.current;
      store.current = rest;
      setCurrent((now) => (now === path ? null : now));
      touch();
      await refresh();
      if (live.current) saved.current();
      return null;
    },
    [backend, page, refresh, touch],
  );

  return {
    listing,
    failed,
    files: store.current,
    current,
    unsaved: Object.values(store.current).some((f) => f.dirty || f.saving),
    open,
    edit,
    flush,
    save,
    keepMine,
    takeDisk,
    create,
    remove,
    refresh,
  };
}
