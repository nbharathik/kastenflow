/* KastenFlow smart kit: a tiny view layer. h() builds a description of some
   elements, render() makes a container match it while touching only the nodes
   that changed, mount() keeps a view in step with a state object, and
   defineComponent() is how every kit component is made. Load after kit.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PROPS = ["value", "checked", "selected", "indeterminate"];
  const TAG_RE = /^([A-Za-z][\w:-]*)((?:[.#][\w-]+)*)$/;

  /** h("ul.kit-grid", { role: "list" }, child, [more]) */
  function h(tag, props, ...children) {
    const m = TAG_RE.exec(tag);
    const p = Object.assign({}, props || {});
    let name = tag;
    if (m) {
      name = m[1];
      (m[2].match(/[.#][\w-]+/g) || []).forEach((part) => {
        if (part[0] === "#") p.id = part.slice(1);
        else p.class = p.class ? p.class + " " + part.slice(1) : part.slice(1);
      });
    }
    return { tag: name, props: p, children: flat(children, []) };
  }
  function flat(list, out) {
    list.forEach((c) => {
      if (Array.isArray(c)) flat(c, out);
      else if (c !== null && c !== undefined && c !== false && c !== true) out.push(typeof c === "object" ? c : String(c));
    });
    return out;
  }

  function create(v, svg) {
    if (typeof v === "string") return root.document.createTextNode(v);
    const inSvg = svg || v.tag === "svg";
    const el = inSvg ? root.document.createElementNS(SVG_NS, v.tag) : root.document.createElement(v.tag);
    patchProps(el, {}, v.props, inSvg);
    patchChildren(el, v.children, inSvg && v.tag !== "foreignObject");
    return el;
  }

  function setAttr(el, name, value) {
    if (value === null || value === undefined || value === false) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
      return;
    }
    const text = value === true ? "" : String(value);
    if (el.getAttribute(name) !== text) el.setAttribute(name, text);
  }

  function styleText(style) {
    if (typeof style === "string") return style;
    return Object.keys(style)
      .filter((k) => style[k] !== null && style[k] !== undefined && style[k] !== false)
      .map((k) => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())) + ":" + style[k])
      .join(";");
  }

  function patchProps(el, old, next, svg) {
    Object.keys(old).forEach((k) => {
      if (!(k in next)) {
        if (k.startsWith("on")) {
          if (el._ev) delete el._ev[k.slice(2).toLowerCase()];
        } else if (PROPS.includes(k) && !svg) el[k] = k === "value" ? "" : false;
        else setAttr(el, k === "className" ? "class" : k, null);
      }
    });
    Object.keys(next).forEach((k) => {
      const v = next[k];
      if (k === "key") return;
      if (k.startsWith("on") && typeof v === "function") {
        const type = k.slice(2).toLowerCase();
        el._ev = el._ev || {};
        if (!el._ev[type]) el.addEventListener(type, (e) => el._ev[type] && el._ev[type](e));
        el._ev[type] = v;
      } else if (k === "style") setAttr(el, "style", v ? styleText(v) : null);
      else if (PROPS.includes(k) && !svg) {
        if (el[k] !== v) el[k] = v;
      } else setAttr(el, k === "className" ? "class" : k, v);
    });
    el._p = next;
  }

  function patchNode(parent, cur, v, svg) {
    if (typeof v === "string") {
      if (cur.nodeType === 3) {
        if (cur.data !== v) cur.data = v;
      } else parent.replaceChild(create(v, svg), cur);
      return;
    }
    const inSvg = svg || v.tag === "svg";
    if (cur.nodeType === 1 && cur.localName === v.tag && cur._p && (cur._p.key === v.props.key)) {
      patchProps(cur, cur._p, v.props, inSvg);
      patchChildren(cur, v.children, inSvg && v.tag !== "foreignObject");
    } else parent.replaceChild(create(v, svg), cur);
  }

  function patchChildren(parent, kids, svg) {
    kids.forEach((v, i) => {
      const cur = parent.childNodes[i];
      if (!cur) parent.appendChild(create(v, svg));
      else patchNode(parent, cur, v, svg);
    });
    while (parent.childNodes.length > kids.length) parent.removeChild(parent.lastChild);
  }

  /** Make `container` show `view` (one description or a list), changing only what differs. */
  function render(container, view) {
    patchChildren(container, flat([view], []), false);
  }

  /**
   * Keep `view(state, api)` drawn in `container`. api.set(patch | fn) updates the
   * state and redraws once, on the next microtask; api.redraw() draws now.
   */
  function mount(container, view, initial) {
    let state = initial === undefined ? {} : initial;
    let queued = false;
    let dead = false;
    const api = {
      get state() {
        return state;
      },
      set(patch) {
        state = typeof patch === "function" ? patch(state) : Object.assign({}, state, patch);
        if (queued || dead) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          api.redraw();
        });
      },
      redraw() {
        if (!dead) render(container, view(state, api));
      },
      destroy() {
        dead = true;
        container.textContent = "";
      },
    };
    api.redraw();
    return api;
  }

  const reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const emptyView = (text) => h("p.kit-empty", { role: "status" }, text || "Nothing to show yet.");

  /**
   * Define a component. `def.view(data, options, api)` returns what to draw for
   * ready data. `kit.components[name](target, options)` mounts it and returns
   * `{ el, update(data), setOptions(patch), redraw(), destroy(), data }`.
   * Options: `data`, or `watch` (a query spec; the notes arrive as data, passed
   * through `map` if given), `label` (accessible name), `empty` (text).
   */
  function defineComponent(name, def) {
    const factory = function (target, options) {
      const el = typeof target === "string" ? root.document.querySelector(target) : target;
      if (!el) throw new Error("kit." + name + ": no element for " + String(target));
      let opts = Object.assign({}, def.defaults, options);
      let data = opts.data;
      let status = opts.watch ? "loading" : "ready";
      let error = null;
      let stop = null;
      let timer = null;
      let dead = false;
      el.classList.add("kit-c", "kit-" + name);
      const api = {
        el,
        get data() {
          return data;
        },
        get options() {
          return opts;
        },
        update(next) {
          data = next;
          status = "ready";
          error = null;
          draw();
        },
        setOptions(patch) {
          opts = Object.assign({}, opts, patch);
          draw();
        },
        redraw: () => draw(),
        destroy() {
          dead = true;
          if (stop) stop();
          if (timer) clearInterval(timer);
          if (def.teardown) def.teardown(api);
          el.textContent = "";
          el.classList.remove("kit-c", "kit-" + name);
        },
      };
      if (def.init) def.init(api, opts);
      function draw() {
        if (dead) return;
        el.setAttribute("aria-busy", status === "loading" ? "true" : "false");
        if (status === "loading") render(el, h("p.kit-loading", { role: "status" }, "Loading…"));
        else if (status === "error") {
          const retry = opts.watch ? h("button.kit-btn", { type: "button", onClick: subscribe }, "Try again") : null;
          render(el, h("p.kit-error", { role: "alert" }, "Could not load this: " + (error && error.message ? error.message : "unknown problem") + " ", retry));
        } else render(el, def.view(data, opts, api));
        if (status === "ready" && def.after) def.after(el, opts, api);
      }
      function subscribe() {
        if (stop) stop();
        const bridge = opts.kasten || root.kasten;
        status = "loading";
        draw();
        if (!bridge) {
          status = "error";
          error = { message: "this page is not connected to KastenFlow." };
          draw();
          return;
        }
        stop = bridge.watch(
          opts.watch,
          (value) => api.update(opts.map ? opts.map(value) : value),
          (err) => {
            status = "error";
            error = err;
            draw();
          },
        );
      }
      if (opts.watch) subscribe();
      else draw();
      const tick = opts.tick === undefined ? def.tick : opts.tick;
      if (tick) timer = setInterval(() => root.document.hidden || draw(), tick);
      return api;
    };
    kit.components[name] = factory;
    return factory;
  }
  kit.h = h;
  kit.render = render;
  kit.mount = mount;
  kit.defineComponent = defineComponent;
  kit.emptyView = emptyView;
  kit.reducedMotion = reducedMotion;
})(window);
