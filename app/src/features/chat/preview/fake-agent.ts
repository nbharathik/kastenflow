// The agent harness in the browser preview, where there is no backend: the
// attachments, saved threads, budgets and connection report the app keeps are
// kept in memory here, so the window's flows can be tried (and seen) without
// the app. Nothing outlives the page.

import type { ChatBudgets, RequestOutcome, ThreadSummary } from "../agent-types";
import { DEFAULT_BUDGETS } from "../agent-types";
import type { ChatClient } from "../client";

type Agent = Pick<ChatClient, "attach" | "attachment" | "dropAttachment" | "continueTurn" | "threads" | "load" | "saveUi" | "state" | "deleteThread" | "budgets" | "setBudgets" | "diagnostics" | "clearDiagnostics">;

let counter = 0;

/** A few requests of the kind the connection report lists: no address, token, prompt or answer. */
const SAMPLE: RequestOutcome[] = [
  { at: Date.now() - 60_000, provider: "chatgpt", model: "gpt-5", route: "chatgpt.com/backend-api/codex/responses", ok: true, stage: "stream", status: 200, kind: null, reason: "", attempts: 1, firstByteMs: 520, totalMs: 4210, renewed: true, rebuilt: false },
  { at: Date.now() - 3 * 60_000, provider: "openai", model: "canned-replies", route: "localhost/preview/v1/chat/completions", ok: false, stage: "request", status: 503, kind: "connection", reason: "closed", attempts: 4, firstByteMs: null, totalMs: 9400, renewed: false, rebuilt: true },
  { at: Date.now() - 4 * 60_000, provider: "openai", model: "canned-replies", route: "localhost/preview/v1/chat/completions", ok: true, stage: "stream", status: 200, kind: null, reason: "", attempts: 1, firstByteMs: 310, totalMs: 1840, renewed: false, rebuilt: false },
];

export function previewAgent(): Agent {
  const kept = new Map<string, { name: string; kind: "text" | "image"; bytes: Uint8Array; mime: string }>();
  const saved = new Map<string, { ui: unknown; updated: number }>();
  let budgets: ChatBudgets = { ...DEFAULT_BUDGETS };
  let outcomes = [...SAMPLE];

  const titleOf = (ui: unknown): string => {
    const saved = ui as { title?: string; messages?: { role?: string; text?: string }[] } | null;
    const first = saved?.messages?.find((m) => m.role === "user")?.text?.trim();
    return saved?.title?.trim() || first?.slice(0, 60) || "New chat";
  };

  return {
    async attach(name, kind, bytes) {
      const id = `att-${Date.now().toString(36)}${++counter}`;
      const mime = kind === "text" ? "text/plain" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png";
      kept.set(id, { name, kind, bytes: bytes.slice(), mime });
      const chars = kind === "text" ? Array.from(new TextDecoder().decode(bytes)).length : undefined;
      return { id, kind, name, mime, bytes: bytes.length, ...(chars !== undefined ? { chars } : {}) };
    },
    async attachment(id) {
      const found = kept.get(id);
      if (!found) throw new Error("That attachment is gone");
      return found.bytes.slice();
    },
    async dropAttachment(id) {
      kept.delete(id);
    },
    continueTurn: async () => null,
    async threads() {
      return [...saved.entries()]
        .sort((a, b) => b[1].updated - a[1].updated)
        .map(([id, { ui, updated }]): ThreadSummary => ({ id, title: titleOf(ui), updated, status: "idle", provider: "Preview", model: "canned-replies" }));
    },
    async load(chat) {
      const found = saved.get(chat);
      if (!found) throw new Error("That chat is not saved");
      return { ui: found.ui, status: "idle", seq: 0, plan: [], title: titleOf(found.ui), provider: "Preview", model: "canned-replies", queued: [] };
    },
    async saveUi(chat, ui) {
      saved.set(chat, { ui, updated: Date.now() });
    },
    state: async (_chat, sinceSeq) => ({ status: "idle", seq: sinceSeq, events: [], gap: false }),
    async deleteThread(chat) {
      saved.delete(chat);
    },
    budgets: async () => budgets,
    async setBudgets(next) {
      budgets = { ...next };
    },
    diagnostics: async () => outcomes,
    async clearDiagnostics() {
      outcomes = [];
    },
  };
}
