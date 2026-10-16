// The files, pictures and long pastes waiting to go with a thread's next
// message. Each is read in the window (attachments.ts), kept with the backend
// (`chat_attach`) and shown as a chip in the box's row until the message is
// sent. A file that cannot be used stays as a chip that says why, until it is
// dismissed: never a toast, never dropped quietly.

import { create } from "zustand";

import type { AttachKind } from "./agent-types";
import { attachEnv } from "./attach-env";
import { AttachRefused, MAX_ATTACHMENTS, labelOf, pastedText, prepare, shouldAttachPaste, type Prepared } from "./attachments";
import { useChat } from "./store";
import { newId, type SentAttachment } from "./thread";

export { attachEnv };

export interface Attached {
  /** This window's name for it, before the backend has one. */
  key: string;
  state: "busy" | "ready" | "error";
  name: string;
  /** What its chip says. */
  label: string;
  kind?: AttachKind;
  /** The backend's id, once kept. */
  id?: string;
  mime?: string;
  bytes?: number;
  chars?: number;
  width?: number;
  height?: number;
  /** Something done to it that the person should know. */
  note?: string;
  /** Why it could not be used. */
  error?: string;
  /** For a long paste: the text, to put back in the box. */
  pasted?: string;
  /** A picture drawn small (a blob: address for this session). */
  thumb?: string;
}

export interface AttachState {
  byThread: Record<string, Attached[]>;
  /** Reads, scales and keeps `files`; a chip for each shows at once. */
  add(thread: string, files: File[]): Promise<void>;
  /** Keeps a long paste. False when it is short, or there is no room: the text is then the box's. */
  addText(thread: string, text: string): Promise<boolean>;
  remove(thread: string, key: string): void;
  /** A long paste put back as text: its chip goes, and the text is given back. */
  asText(thread: string, key: string): string | null;
  /** The ready attachments, for a message about to go; the row is cleared. */
  take(thread: string): Attached[];
  /** What `take` took, put back because the message did not go. */
  restore(thread: string, items: Attached[]): void;
  busy(thread: string): boolean;
}

const message = (err: unknown) => (err instanceof AttachRefused || err instanceof Error ? err.message : String(err));

/** A ready attachment as the message that holds it names it. */
export const sentOf = (item: Attached): SentAttachment => ({ id: item.id ?? "", name: item.name, kind: item.kind ?? "text", label: item.label, ...(item.thumb ? { thumb: item.thumb } : {}) });

function thumbOf(item: Prepared): string | undefined {
  if (item.kind !== "image") return undefined;
  try {
    return URL.createObjectURL(new Blob([item.bytes.slice()], { type: item.mime }));
  } catch {
    // No object addresses here (a test): the chip has its name.
    return undefined;
  }
}

function forget(thumb: string | undefined): void {
  if (!thumb) return;
  try {
    URL.revokeObjectURL(thumb);
  } catch {
    // Nothing to give back.
  }
}

/** Keys removed while their file was still being read: what was kept for them is let go of. */
const removed = new Set<string>();

export const useAttachments = create<AttachState>()((set, get) => {
  const rows = (thread: string) => get().byThread[thread] ?? [];
  const setRows = (thread: string, next: Attached[]) =>
    set((s) => {
      const byThread = { ...s.byThread };
      if (next.length) byThread[thread] = next;
      else delete byThread[thread];
      return { byThread };
    });
  const patch = (thread: string, key: string, change: Partial<Attached>) => setRows(thread, rows(thread).map((a) => (a.key === key ? { ...a, ...change } : a)));
  const drop = (id: string) => void useChat.getState().ensure().dropAttachment(id).catch(() => {});

  /** Prepares and keeps one attachment for the chip `key`; `extra` is set on its chip once it is ready. */
  async function keep(thread: string, key: string, make: () => Promise<Prepared>, extra: Partial<Attached> = {}): Promise<void> {
    try {
      const made = await make();
      const info = await useChat.getState().ensure().attach(made.name, made.kind, made.bytes);
      if (removed.delete(key)) return drop(info.id);
      patch(thread, key, {
        state: "ready",
        name: info.name || made.name,
        label: labelOf({ ...made, name: info.name || made.name }),
        kind: info.kind,
        id: info.id,
        mime: info.mime,
        bytes: info.bytes,
        chars: info.chars ?? made.chars,
        width: info.width ?? made.width,
        height: info.height ?? made.height,
        ...(made.note ? { note: made.note } : {}),
        thumb: thumbOf(made),
        ...extra,
      });
    } catch (err) {
      if (removed.delete(key)) return;
      patch(thread, key, { state: "error", error: message(err) });
    }
  }

  const room = (thread: string) => MAX_ATTACHMENTS - rows(thread).filter((a) => a.state !== "error").length;
  const row = (name: string): Attached => ({ key: newId("att"), state: "busy", name, label: name });

  return {
    byThread: {},

    async add(thread, files) {
      const kept = files.slice(0, Math.max(0, room(thread)));
      const left = files.length - kept.length;
      const added = kept.map((file) => row(file.name || "file"));
      if (left > 0) {
        const files = `${left} ${left === 1 ? "file" : "files"}`;
        added.push({ ...row(files), state: "error", error: `At most ${MAX_ATTACHMENTS} attachments go with a message; ${files} left out.` });
      }
      setRows(thread, [...rows(thread), ...added]);
      await Promise.all(kept.map((file, i) => keep(thread, added[i]!.key, () => prepare(file, attachEnv.deps))));
    },

    async addText(thread, text) {
      if (!shouldAttachPaste(text) || room(thread) <= 0) return false;
      const added = row("Pasted text");
      setRows(thread, [...rows(thread), added]);
      await keep(thread, added.key, async () => pastedText(text), { pasted: text });
      return true;
    },

    remove(thread, key) {
      const found = rows(thread).find((a) => a.key === key);
      if (!found) return;
      setRows(
        thread,
        rows(thread).filter((a) => a.key !== key),
      );
      forget(found.thumb);
      if (found.state === "busy") removed.add(key);
      else if (found.state === "ready" && found.id) drop(found.id);
    },

    asText(thread, key) {
      const text = rows(thread).find((a) => a.key === key)?.pasted ?? null;
      if (text !== null) get().remove(thread, key);
      return text;
    },

    take(thread) {
      const ready = rows(thread).filter((a) => a.state === "ready");
      setRows(thread, []);
      return ready;
    },

    restore(thread, items) {
      setRows(thread, [...items, ...rows(thread)]);
    },

    busy: (thread) => rows(thread).some((a) => a.state === "busy"),
  };
});
