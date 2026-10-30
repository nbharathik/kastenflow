/* KastenFlow smart kit: keyboard and focus helpers. Load after kit.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const KEYS = {
    both: { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 },
    horizontal: { ArrowRight: 1, ArrowLeft: -1 },
    vertical: { ArrowDown: 1, ArrowUp: -1 },
  };

  /**
   * One tab stop for a group of controls; arrow keys, Home and End move within it.
   * options: selector (default "[data-roving]"), orientation (both|horizontal|vertical), wrap.
   * Call refresh() after the group is redrawn. Returns { refresh, destroy }.
   */
  function roving(container, options) {
    const o = Object.assign({ selector: "[data-roving]", orientation: "both", wrap: true }, options);
    const map = KEYS[o.orientation] || KEYS.both;
    let current = 0;
    const items = () => Array.prototype.slice.call(container.querySelectorAll(o.selector)).filter((el) => !el.hasAttribute("disabled"));
    function refresh() {
      const list = items();
      current = Math.min(current, Math.max(0, list.length - 1));
      list.forEach((el, i) => el.setAttribute("tabindex", i === current ? "0" : "-1"));
    }
    function move(to) {
      const list = items();
      if (!list.length) return;
      current = to;
      refresh();
      list[current].focus();
    }
    function onKey(e) {
      const list = items();
      const at = list.indexOf(e.target.closest ? e.target.closest(o.selector) : e.target);
      if (at < 0) return;
      let next = null;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = list.length - 1;
      else if (map[e.key]) {
        next = at + map[e.key];
        if (next < 0 || next >= list.length) next = o.wrap ? (next + list.length) % list.length : at;
      }
      if (next === null) return;
      e.preventDefault();
      move(next);
    }
    function onFocus(e) {
      const at = items().indexOf(e.target);
      if (at >= 0 && at !== current) {
        current = at;
        refresh();
      }
    }
    container.addEventListener("keydown", onKey);
    container.addEventListener("focusin", onFocus);
    refresh();
    return {
      refresh,
      destroy() {
        container.removeEventListener("keydown", onKey);
        container.removeEventListener("focusin", onFocus);
      },
    };
  }

  /** Run handlers by key name: onKeys(el, { Escape: close, "Enter": open }). Returns a function that removes them. */
  function onKeys(el, handlers) {
    const fn = (e) => {
      const h = handlers[e.key];
      if (h) h(e);
    };
    el.addEventListener("keydown", fn);
    return () => el.removeEventListener("keydown", fn);
  }

  /** Keep Tab inside `container` (a dialog) until the returned function is called, which restores focus. */
  function trapFocus(container) {
    const before = root.document.activeElement;
    const fn = (e) => {
      if (e.key !== "Tab") return;
      const list = Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE));
      if (!list.length) return e.preventDefault();
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && root.document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && root.document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", fn);
    const first = container.querySelector(FOCUSABLE);
    if (first) first.focus();
    return function release() {
      container.removeEventListener("keydown", fn);
      if (before && before.focus) before.focus();
    };
  }

  /** Say something to screen readers without moving focus. */
  function announce(text) {
    let live = root.document.getElementById("kit-live");
    if (!live) {
      live = root.document.createElement("div");
      live.id = "kit-live";
      live.className = "kit-sr";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      root.document.body.appendChild(live);
    }
    live.textContent = "";
    live.textContent = String(text);
  }

  kit.keys = { roving, onKeys, trapFocus, announce, FOCUSABLE };
})(window);
