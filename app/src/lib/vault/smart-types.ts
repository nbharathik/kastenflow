// Smart pages: the shared contract. A smart page is a normal page with
// `layout: smart` and a code folder beside it (`<page>.smart/`: smart.yaml,
// index.html, scripts, styles, data/*.json, assets/). It runs in a sandboxed
// frame loaded from `smart://` (see `kitUrl`, `SMART_CSP`) and talks
// to the app only through the messages below. These types mirror, field for field,
// crates/kasten-core/src/smart/. `parseBridgeRequest` is the schema check the app
// runs on everything a page sends.
//
// Page to app, `{ id, kind, args }` (50 calls a second, answers up to 2 MB):
//
//   kind        args                                     answer value
//   ----------  ---------------------------------------  ------------------------------
//   query       { tag, filter?, sort?, limit? }          notes
//   list        { project?, tag?, type? }                notes
//   read        { id }                                   one note, with its text
//   search      { q, limit? }                            hits
//   journal     { date: "YYYY-MM-DD" }                   the day's journal page
//   project     (none)                                   the page's project
//   tasks       { project?, tag?, done? }                tasks
//   board       { path }                                 a board's cards
//   watch       { watchId, query }                       the first result; later ones
//                                                        arrive as `watch` events
//   unwatch     { watchId }                              nothing
//   open        { target }  (note id or page path)       nothing
//   theme       (none)                                   "light" | "dark"
//   resize      { px }                                   nothing
//   log         { args: [...] }                          nothing
//   report      { kind, message, source?, line? }        nothing (an error the kit caught)
//   update      { id, props }                  write     the changed note
//   addTags     { id, tags }                   write     the changed note
//   createNote  { title, tags?, props?, body?, project? }  write   the new note
//   append      { id, md }                     write     the changed note
//   toggleTodo  { id, index }                  write     the changed note
//
// App to page, one answer per request, `{ id, ok: true, value? }` or
// `{ id, ok: false, error: { code, message } }` with `code` one of rate_limited,
// too_large, refused, bad_request, not_found; and events nobody asked for:
// `{ event: "init", pageId, theme, view? }` (first), `{ event: "watch", watchId,
// value }` (debounced 300 ms after the vault changes) and `{ event: "theme", theme }`.
//
// Writes run as the actor `smart:<page path>` under the project's agent mode, one
// change per call. Errors the kit catches (`error`, `unhandledrejection`,
// `console.error`) go to the app as `report`, which keeps the last 50 per page.

export * from "./smart-contract";
export { isBridgeError, parseBridgeRequest, requestIdOf } from "./smart-parse";
