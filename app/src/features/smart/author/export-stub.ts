// The script a saved copy of a smart page carries in place of the bridge. The
// page's kit talks to a "transport"; in the app that is a message to the
// window, here it is this object, which answers reads from the data the copy
// was saved with and refuses every write. It has no way out of the file: it
// sends no message, opens no connection and changes nothing.

/** The pre-script: the data, the answers and the refusals. `__DATA__` is replaced by the saved answers as JSON. */
export const STUB_SOURCE = `(function () {
  "use strict";
  window.__kitManual = true;
  var saved = __DATA__;
  var byKey = Object.create(null);
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v !== null && typeof v === "object") {
      return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    }
    var s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  saved.forEach(function (e) { byKey[e.key] = e; });
  var WRITES = ["update", "addTags", "createNote", "append", "toggleTodo"];
  var QUIET = ["resize", "log", "report", "unwatch", "open"];
  var listeners = [];
  function reply(m) {
    setTimeout(function () { listeners.forEach(function (fn) { fn(m); }); }, 0);
  }
  function theme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  window.__exportTransport = {
    listen: function (fn) { listeners.push(fn); },
    hello: function () { reply({ event: "init", pageId: "", theme: theme() }); },
    post: function (msg) {
      var id = msg.id, kind = msg.kind, args = msg.args;
      if (kind === "theme") return reply({ id: id, ok: true, value: theme() });
      if (QUIET.indexOf(kind) >= 0) return reply({ id: id, ok: true });
      if (WRITES.indexOf(kind) >= 0) {
        return reply({ id: id, ok: false, error: { code: "refused", message: "This is a saved copy of the page. Open it in KastenFlow to change things." } });
      }
      var as = kind === "watch" ? "query" : kind;
      var spec = kind === "watch" ? (args && args.query) : args;
      var hit = byKey[as + "|" + (spec === undefined ? "" : stable(spec))];
      if (!hit && spec && typeof spec.tag === "string") {
        hit = saved.find(function (e) { return e.kind === as && e.args && e.args.tag === spec.tag; });
      }
      if (hit) return reply({ id: id, ok: true, value: hit.value });
      reply({ id: id, ok: false, error: { code: "not_found", message: "This copy was saved without an answer to that request." } });
    }
  };
})();`;

/** The script that starts the kit on the stub; it runs right after the kit's own script. */
export const START_SOURCE = `(function () {
  if (window.kit && window.kit.start && window.__exportTransport) {
    window.kit.start({ transport: window.__exportTransport, captureErrors: false });
    window.__exportTransport.hello();
  }
})();`;

/** The policy of a saved copy: its own text and nothing from anywhere. */
export const EXPORT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
