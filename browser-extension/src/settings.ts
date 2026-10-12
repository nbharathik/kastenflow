// What the extension keeps in the browser's storage: the token Kasten gave it,
// the port, the vault's name and where the last capture went. Read back with
// care, so a value of the wrong kind falls back to the usual one.

import type { StorageArea } from "./env.js";
import { DEFAULT_PORT, NO_SETTINGS, type Settings, type Target } from "./model.js";

const KEYS = ["token", "port", "vault", "lastTarget"];

/** Whether `port` is one Kasten's Settings accept. */
export const validPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535;

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** A target as stored, or the Inbox for anything else. */
export function readTarget(value: unknown): Target {
  if (value && typeof value === "object") {
    const t = value as Record<string, unknown>;
    if (t["kind"] === "project" && text(t["project"])) return { kind: "project", project: t["project"] };
    if (t["kind"] === "page" && text(t["path"])) return { kind: "page", path: t["path"], ...(text(t["heading"]) ? { heading: t["heading"] } : {}) };
  }
  return { kind: "inbox" };
}

export async function loadSettings(storage: StorageArea): Promise<Settings> {
  let stored: Record<string, unknown> = {};
  try {
    stored = await storage.get(KEYS);
  } catch {
    // Nothing kept, nothing paired.
  }
  return {
    token: text(stored["token"]) ? stored["token"] : NO_SETTINGS.token,
    port: validPort(stored["port"]) ? stored["port"] : DEFAULT_PORT,
    vault: text(stored["vault"]) ? stored["vault"] : NO_SETTINGS.vault,
    lastTarget: readTarget(stored["lastTarget"]),
  };
}

/** Keeps a token Kasten just gave, and the vault's name. */
export function savePairing(storage: StorageArea, token: string, vault: string): Promise<void> {
  return storage.set({ token, vault });
}

/** Forgets the token (it was revoked, or the person unpaired). Kasten's list is Kasten's to change. */
export function forgetPairing(storage: StorageArea): Promise<void> {
  return storage.remove(["token", "vault"]);
}

export function savePort(storage: StorageArea, port: number): Promise<void> {
  if (!validPort(port)) return Promise.reject(new Error("A port is a number from 1024 to 65535"));
  return storage.set({ port });
}

export function saveLastTarget(storage: StorageArea, target: Target): Promise<void> {
  return storage.set({ lastTarget: target });
}
