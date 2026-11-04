// The runner of a code picture: it lives in a sandboxed frame (scripts and nothing else, no network, no
// vault, no way to any command) and does one thing. It says it is ready, takes one message with the code,
// the text of the inputs and the deck's colours, runs the code as the body of a function
// (kit, inputs, theme), and answers with one message: the SVG the code returned, or the error with the
// line of the code it came from. The window that owns the frame ends it after the answer, or when the
// time is up, so a program that never ends is cut off from outside.
(function () {
  "use strict";

  // The lines the wrapper adds before the code, so a line number is the code's own.
  var OFFSET = 2;
  var MAX_SVG = 1024 * 1024;
  var MOST_LOGS = 50;
  var LOG_CHARS = 300;

  var logs = [];
  var current = null;
  var finished = false;

  // The ways out of the frame, taken away before any code runs. The frame's policy allows no request (`connect-src 'none'`), but
  // Chromium does not hold a peer connection's traffic to it, so these are gone from the code's world as well: it can draw, and
  // it cannot call out. The kit needs none of them. (A frame inside this one, or a worker, is not allowed by the policy either.)
  var WAYS_OUT = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "WebSocket", "WebTransport", "EventSource", "fetch", "XMLHttpRequest"];

  function takeAway(target, name) {
    try {
      Object.defineProperty(target, name, { value: undefined, writable: false, configurable: true });
    } catch (e) {
      try {
        target[name] = undefined;
      } catch (e2) {
        // Left as it is: there is nothing more to try.
      }
    }
  }

  WAYS_OUT.forEach(function (name) {
    takeAway(window, name);
  });
  takeAway(window.navigator, "sendBeacon");
  if (typeof Navigator === "function") takeAway(Navigator.prototype, "sendBeacon");

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  function short(text, limit) {
    return String(text).slice(0, limit);
  }

  function fail(id, message, line, column) {
    if (finished) return;
    finished = true;
    post({
      type: "error",
      id: id,
      message: short(message, 500),
      line: typeof line === "number" && line > 0 ? line : null,
      column: typeof column === "number" && column > 0 ? column : null,
    });
  }

  // Where in the code a stack says an error came from.
  function lineIn(stack) {
    var match = /generator\.js:(\d+):(\d+)/.exec(String(stack || ""));
    return match ? { line: Number(match[1]) - OFFSET, column: Number(match[2]) } : null;
  }

  function describe(err) {
    if (err && err.message) return (err.name ? err.name + ": " : "") + err.message;
    return String(err);
  }

  ["log", "info", "warn", "error", "debug"].forEach(function (name) {
    console[name] = function () {
      if (logs.length >= MOST_LOGS) return;
      var parts = Array.prototype.map.call(arguments, function (part) {
        if (typeof part === "string") return part;
        try {
          return JSON.stringify(part);
        } catch (e) {
          return String(part);
        }
      });
      logs.push(short(parts.join(" "), LOG_CHARS));
    };
  });

  // A syntax error in the code, or an error in something it started that is no longer waited for.
  window.addEventListener("error", function (event) {
    if (current === null) return;
    var at = event.error && lineIn(event.error.stack);
    var line = at ? at.line : event.lineno - OFFSET;
    fail(current, event.error ? describe(event.error) : event.message, line, at ? at.column : event.colno);
    event.preventDefault();
  });

  window.addEventListener("unhandledrejection", function (event) {
    if (current === null) return;
    var at = lineIn(event.reason && event.reason.stack);
    fail(current, describe(event.reason), at && at.line, at && at.column);
    event.preventDefault();
  });

  function svgOf(result) {
    if (typeof result === "string") return result;
    if (result && typeof result.svg === "string") return result.svg;
    return null;
  }

  function run(job) {
    current = job.id;
    var kit = window.createKit(job.theme || {});
    var inputs = job.inputs && typeof job.inputs === "object" ? job.inputs : {};
    var script = document.createElement("script");
    script.textContent = '"use strict";\nasync function __generator(kit, inputs, theme) {\n' + job.code + "\n}\n//# sourceURL=generator.js";
    document.head.appendChild(script);
    // A syntax error has already been told by the error event above.
    if (finished) return;
    if (typeof window.__generator !== "function") {
      fail(job.id, "The code could not be read.");
      return;
    }
    Promise.resolve()
      .then(function () {
        return window.__generator(kit, inputs, kit.theme);
      })
      .then(function (result) {
        var svg = svgOf(result);
        if (svg === null) throw new Error("The code must return the SVG text, for example: return kit.svg(400, 300, body).");
        if (svg.length > MAX_SVG) throw new Error("The picture is larger than 1 MB.");
        if (!/<svg[\s>]/.test(svg)) throw new Error("What the code returned is not an SVG: it has no <svg> element.");
        if (finished) return;
        finished = true;
        post({ type: "result", id: job.id, svg: svg, logs: logs, warnings: kit.warnings });
      })
      .catch(function (err) {
        var at = lineIn(err && err.stack);
        fail(job.id, describe(err), at && at.line, at && at.column);
      });
  }

  window.addEventListener("message", function (event) {
    // Only the window that holds this frame may tell it what to run.
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== "run" || typeof data.id !== "string" || typeof data.code !== "string") return;
    // One run in a frame: the next code gets a frame of its own.
    if (current !== null) return;
    run(data);
  });

  post({ type: "ready" });
})();
