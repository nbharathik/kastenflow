/* KastenFlow smart kit, version 1: the core. A classic script (ES2020, no build
   step). It defines window.kit and, inside a smart frame, starts window.kasten:
   the promise-based client for the app's bridge. Load the other kit files after
   this one: lib/dom.js, lib/dates.js, lib/format.js, lib/keys.js, then the
   components you use. */
(function (root) {
  "use strict";

  const kit = root.kit || (root.kit = {});
  kit.version = "1";
  /** name -> function(target, options): the components the page can mount. */
  kit.components = kit.components || {};

  const HOST_CODES = ["rate_limited", "too_large", "refused", "bad_request", "not_found"];
  const NO_ARGS = ["project", "theme"];
  const FIELD1 = { read: "id", search: "q", journal: "date", board: "path", open: "target" };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** What every failed call rejects with. `code` is a host code or timeout, closed, bad_response. */
  class KastenError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "KastenError";
      this.code = code;
      /** Worth trying again a little later. */
      this.retryable = code === "rate_limited" || code === "timeout";
    }
  }
  kit.KastenError = KastenError;

  // ---- the argument check (the host checks again; this saves a round trip) ----
  const isStr = (v) => typeof v === "string" && v.length > 0;
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const CHECKS = {
    query: (a) => isStr(a.tag) || "query needs a tag",
    list: () => true,
    read: (a) => isStr(a.id) || "read needs an id",
    search: (a) => isStr(a.q) || "search needs text",
    journal: (a) => (isStr(a.date) && DATE_RE.test(a.date)) || "journal needs a date like 2027-03-01",
    project: () => true,
    tasks: () => true,
    board: (a) => isStr(a.path) || "board needs a path",
    watch: (a) => (isStr(a.watchId) && isObj(a.query) && isStr(a.query.tag)) || "watch needs a query with a tag",
    unwatch: (a) => isStr(a.watchId) || "unwatch needs a watch id",
    open: (a) => isStr(a.target) || "open needs a note id or page path",
    theme: () => true,
    resize: (a) => (typeof a.px === "number" && isFinite(a.px) && a.px >= 0) || "resize needs a height in pixels",
    log: (a) => Array.isArray(a.args) || "log needs a list",
    report: (a) => (isStr(a.kind) && typeof a.message === "string") || "report needs a kind and a message",
    update: (a) => (isStr(a.id) && isObj(a.props)) || "update needs an id and props",
    addTags: (a) => (isStr(a.id) && Array.isArray(a.tags) && a.tags.every(isStr)) || "addTags needs an id and a list of tags",
    createNote: (a) => isStr(a.title) || "createNote needs a title",
    append: (a) => (isStr(a.id) && typeof a.md === "string") || "append needs an id and text",
    toggleTodo: (a) => (isStr(a.id) && Number.isInteger(a.index) && a.index >= 0) || "toggleTodo needs an id and a task number",
  };
  kit.bridgeKinds = Object.keys(CHECKS);

  /**
   * The bridge client. `transport` is `{ post(message), listen(fn) }`: the kit
   * posts requests `{id, kind, args}` and gets answers `{id, ok, value|error}`
   * and events `{event: init|watch|theme, ...}`.
   */
  function createBridge(options) {
    const transport = options.transport;
    const timeoutMs = options.timeout === undefined ? 10000 : options.timeout;
    const pending = new Map();
    const watches = new Map();
    const themeHandlers = new Set();
    let nextId = 1;
    let nextWatch = 1;
    let init = null;
    let theme = null;
    const readyWaiters = [];

    function applyInit(info) {
      if (init && init.pageId) return;
      init = info;
      readyWaiters.splice(0).forEach((resolve) => resolve(init));
    }

    function onMessage(msg) {
      if (!isObj(msg)) return;
      if (typeof msg.event === "string") return onEvent(msg);
      const entry = typeof msg.id === "number" ? pending.get(msg.id) : undefined;
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok === true) entry.resolve(msg.value);
      else if (msg.ok === false && isObj(msg.error)) {
        const code = HOST_CODES.includes(msg.error.code) ? msg.error.code : "bad_response";
        entry.reject(new KastenError(code, String(msg.error.message || "The app refused the request.")));
      } else entry.reject(new KastenError("bad_response", "The app sent an answer the kit could not read."));
    }

    function onEvent(msg) {
      if (msg.event === "init") applyInit({ pageId: String(msg.pageId || ""), theme: msg.theme, view: msg.view });
      if (msg.event === "init" || msg.event === "theme") {
        if (msg.theme !== "light" && msg.theme !== "dark") return;
        theme = msg.theme;
        themeHandlers.forEach((fn) => fn(theme));
      } else if (msg.event === "watch") {
        const cb = watches.get(msg.watchId);
        if (cb) cb(msg.value);
      }
    }
    transport.listen(onMessage);

    function call(kind, args, opts) {
      const check = CHECKS[kind];
      const a = args === undefined || args === null ? {} : args;
      if (!check) return Promise.reject(new KastenError("bad_request", "Unknown call: " + kind));
      if (!isObj(a)) return Promise.reject(new KastenError("bad_request", kind + " needs an object of arguments"));
      const verdict = check(a);
      if (verdict !== true) return Promise.reject(new KastenError("bad_request", String(verdict)));
      const id = nextId++;
      const ms = opts && opts.timeout !== undefined ? opts.timeout : timeoutMs;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new KastenError("timeout", "The app did not answer " + kind + " in time."));
        }, ms);
        pending.set(id, { resolve, reject, timer });
        const message = NO_ARGS.includes(kind) ? { id, kind } : { id, kind, args: a };
        try {
          transport.post(message);
        } catch (e) {
          pending.delete(id);
          clearTimeout(timer);
          reject(new KastenError("closed", "Could not reach the app."));
        }
      });
    }

    /** One call whose argument may be a single value for the call's main field. */
    function shorthand(kind) {
      return (arg, opts) => {
        let a = arg;
        if (kind === "journal" && arg instanceof Date) a = { date: root.kit.dates ? root.kit.dates.isoDate(arg) : arg.toISOString().slice(0, 10) };
        else if (typeof arg === "string" && FIELD1[kind]) a = { [FIELD1[kind]]: arg };
        else if (kind === "query" && typeof arg === "string") a = { tag: arg };
        else if (kind === "resize" && typeof arg === "number") a = { px: arg };
        return call(kind, a, opts);
      };
    }

    const api = { call };
    ["query", "list", "read", "search", "journal", "tasks", "board", "open", "resize", "update", "addTags", "createNote", "append", "toggleTodo"].forEach((k) => {
      api[k] = shorthand(k);
    });
    api.project = (opts) => call("project", null, opts);
    api.theme = (opts) => call("theme", null, opts);
    /** Fire and forget: the page's console output reaches the app's log. */
    api.log = (...args) => {
      call("log", { args: args.map((a) => plain(a)) }).catch(() => {});
    };
    api.search = (arg, limit, opts) => {
      const a = typeof arg === "string" ? { q: arg } : arg;
      return call("search", typeof limit === "number" && a ? Object.assign({}, a, { limit }) : a, typeof limit === "object" ? limit : opts);
    };
    api.report = (r) => {
      const msg = { kind: r.kind, message: String(r.message).slice(0, 2000) };
      if (r.source) msg.source = String(r.source).slice(0, 500);
      if (Number.isFinite(r.line)) msg.line = r.line;
      return call("report", msg).catch(() => {});
    };
    api.toggle = (id, index) => call("toggleTodo", { id, index });

    /**
     * Keep a query live. `cb(value)` runs with the first result and again after
     * each change; `onError(error)` if the query fails. Returns a function that stops it.
     */
    api.watch = (spec, cb, onError) => {
      const query = typeof spec === "string" ? { tag: spec } : spec;
      const watchId = "w" + nextWatch++;
      watches.set(watchId, cb);
      call("watch", { watchId, query })
        .then((value) => {
          if (watches.has(watchId)) cb(value);
        })
        .catch((error) => {
          watches.delete(watchId);
          if (onError) onError(error);
          else console.warn("kasten.watch failed: " + error.message);
        });
      return function stop() {
        if (!watches.delete(watchId)) return;
        call("unwatch", { watchId }).catch(() => {});
      };
    };

    /** Resolves with `{ pageId, theme, view }` once the app has said hello. */
    api.ready = () => (init ? Promise.resolve(init) : new Promise((resolve) => readyWaiters.push(resolve)));
    api.onTheme = (fn) => {
      themeHandlers.add(fn);
      return () => themeHandlers.delete(fn);
    };
    api.currentTheme = () => theme;
    api.pendingCount = () => pending.size;
    api._applyInit = (info) => {
      if (init) return;
      theme = info.theme === "light" || info.theme === "dark" ? info.theme : theme;
      applyInit(info);
    };
    return api;
  }
  kit.createBridge = createBridge;

  /** Console arguments as plain JSON-safe values. */
  function plain(v, depth) {
    const d = depth || 0;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v;
    if (v === undefined) return null;
    if (v instanceof Error) return v.name + ": " + v.message;
    if (typeof v === "function") return "[function]";
    if (d > 3) return "[deep]";
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => plain(x, d + 1));
    if (typeof v === "object") {
      const out = {};
      Object.keys(v)
        .slice(0, 50)
        .forEach((k) => {
          if (k !== "__proto__") out[k] = plain(v[k], d + 1);
        });
      return out;
    }
    return String(v);
  }

  /**
   * Send `error`, `unhandledrejection` and `console.error` to the app (`report`,
   * at most `max` per page load). Returns a function that undoes it.
   */
  function captureErrors(bridge, win, max) {
    const limit = max || 100;
    const con = win.console;
    const original = con.error;
    let sent = 0;
    let busy = false;
    function send(r) {
      if (busy || sent >= limit) return;
      sent++;
      busy = true;
      try {
        bridge.report(r);
      } finally {
        busy = false;
      }
    }
    const text = (v) => (v instanceof Error ? v.message : typeof v === "string" ? v : safeJson(v));
    const onError = (e) => send({ kind: "error", message: String(e.message || (e.error && e.error.message) || "Script error"), source: e.filename, line: e.lineno });
    const onRejection = (e) => send({ kind: "unhandledrejection", message: e.reason === undefined ? "Promise rejected" : text(e.reason) });
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onRejection);
    con.error = function () {
      const args = Array.prototype.slice.call(arguments);
      send({ kind: "console.error", message: args.map(text).join(" ") });
      return original.apply(con, args);
    };
    return function undo() {
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejection);
      con.error = original;
    };
  }
  function safeJson(v) {
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch (e) {
      return String(v);
    }
  }
  kit.captureErrors = captureErrors;

  /** Make the page follow the app's theme: data-theme on <html>. */
  function applyTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    root.document.documentElement.setAttribute("data-theme", theme);
  }
  kit.applyTheme = applyTheme;

  let undoCapture = null;
  /**
   * Start the bridge: window.kasten, theme following, error capture. It runs by
   * itself in a smart frame; a test passes its own `transport`.
   */
  kit.start = function start(options) {
    const opts = options || {};
    kit.stop();
    const transport =
      opts.transport ||
      {
        post: (m) => root.parent.postMessage(m, "*"),
        listen: (fn) =>
          root.addEventListener("message", (e) => {
            if (e.source === root.parent) fn(e.data);
          }),
      };
    const bridge = createBridge({ transport, timeout: opts.timeout });
    root.kasten = bridge;
    bridge.onTheme(applyTheme);
    if (opts.captureErrors !== false) undoCapture = captureErrors(bridge, root);
    // If the hello was missed, the theme call still tells the page its colours.
    bridge
      .theme()
      .then((t) => {
        applyTheme(t);
        bridge._applyInit({ pageId: "", theme: t });
      })
      .catch(() => {});
    return bridge;
  };
  kit.stop = function stop() {
    if (undoCapture) undoCapture();
    undoCapture = null;
  };

  if (root.parent && root.parent !== root && !root.__kitManual) kit.start();
})(window);
