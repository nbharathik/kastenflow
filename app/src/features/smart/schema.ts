// What the window accepts from a smart page's frame: one message at a time,
// checked against the contract (`parseBridgeRequest`) before anything is done
// with it. A message that does not fit gets a plain `bad_request` back when it
// has an id to answer to, and is dropped when it has none.

import {
  isBridgeError,
  parseBridgeRequest,
  requestIdOf,
  type BridgeCall,
  type BridgeError,
  type BridgeRequest,
} from "../../lib/vault/smart-types";

/**
 * The sandbox of a smart page's frame: its own scripts and nothing else. No
 * `allow-same-origin` (the page's origin stays opaque, so it can reach neither
 * the window nor storage), no popups, no top navigation, no forms, no modals,
 * no downloads, no pointer lock.
 */
export const SMART_SANDBOX = "allow-scripts";

export type Checked = { ok: true; request: BridgeRequest } | { ok: false; id: number | null; error: BridgeError };

/** A message from the frame, checked: the request rebuilt from the fields it may carry, or why not. */
export function checkMessage(raw: unknown): Checked {
  const parsed = parseBridgeRequest(raw);
  if (isBridgeError(parsed)) return { ok: false, id: requestIdOf(raw), error: parsed };
  return { ok: true, request: parsed };
}

/** The calls the window answers itself; the rest go to the app, which reads or changes the vault. */
export type OwnCall = Extract<BridgeCall, { kind: "watch" | "unwatch" | "theme" | "resize" | "log" | "report" }>;
export type VaultCall = Exclude<BridgeCall, OwnCall>;

const OWN: readonly string[] = ["watch", "unwatch", "theme", "resize", "log", "report"];

export function isOwnCall(call: BridgeCall): call is OwnCall {
  return OWN.includes(call.kind);
}
