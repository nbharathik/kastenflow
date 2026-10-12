// What the extension and Kasten say to each other, and what the extension keeps.
// The routes are Kasten's: POST /v1/pair, GET /v1/targets, POST /v1/capture on
// 127.0.0.1. They add and list; nothing here reads a note.
/** The port Kasten listens on unless its Settings say otherwise. */
export const DEFAULT_PORT = 7434;
export const NO_SETTINGS = { token: null, port: DEFAULT_PORT, vault: null, lastTarget: { kind: "inbox" } };
