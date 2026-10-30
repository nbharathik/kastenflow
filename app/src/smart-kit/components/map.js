/* KastenFlow smart kit: map. A world map (Equal Earth projection, drawn from
   the map data in data/world-110m.js) with pins, labels and highlighted regions.
   Load after kit.js, lib/dom.js, lib/keys.js, add kit-visual.css, then load
   data/world-110m.js after this file. Nothing is fetched: the page has no network.

   Data: { pins: [{ label, lat, lon, note?, id? }], highlight: ["France", "Asia", { region, label? }] }
         or just the list of pins.
   Options: fit ("world", or "content" to zoom to the pins and highlighted regions),
   labels (true, false, or "auto": shown up to 12 pins), list (false hides the pin list),
   world (map data, default kit.maps.world), onSelect(pin, index), label, empty. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;

  // ---- Equal Earth projection (Savric, Patterson and Jenny, 2018) ----
  const A1 = 1.340264;
  const A2 = -0.081106;
  const A3 = 0.000893;
  const A4 = 0.003796;
  const K = Math.sqrt(3) / 2;
  const RAD = Math.PI / 180;
  const raw = (lon, lat) => {
    const t = Math.asin(K * Math.sin(lat * RAD));
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    return [(2 * Math.sqrt(3) * lon * RAD * Math.cos(t)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
  };
  const X_MAX = raw(180, 0)[0];
  const Y_MAX = raw(0, 90)[1];
  const WIDTH = 1000;
  const HEIGHT = Math.round((WIDTH * Y_MAX) / X_MAX);

  /** [x, y] on a WIDTH x HEIGHT canvas for a longitude and latitude in degrees. */
  function project(lon, lat) {
    const p = raw(lon, Math.max(-90, Math.min(90, lat)));
    return [(WIDTH / 2) * (1 + p[0] / X_MAX), (HEIGHT / 2) * (1 - p[1] / Y_MAX)];
  }

  const maps = { world: null, project, WIDTH, HEIGHT };
  /** Install map data (data/world-110m.js does this). */
  maps.setWorld = (world) => {
    maps.world = world && Array.isArray(world.regions) ? world : null;
  };
  kit.maps = maps;

  // ---- drawing ----
  const fix = (n) => (Math.round(n * 10) / 10).toString();
  const paths = new WeakMap();
  function pathOf(region) {
    if (!paths.has(region)) {
      const rings = Array.isArray(region.rings) ? region.rings : [];
      paths.set(
        region,
        rings
          .filter((r) => Array.isArray(r) && r.length > 2)
          .map((r) => "M" + r.map((c) => project(c[0], c[1]).map(fix).join(" ")).join("L") + "Z")
          .join(""),
      );
    }
    return paths.get(region);
  }
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const isOn = (region, keys) => keys.some((k) => [region.id, region.iso, region.name, region.continent].some((v) => v !== undefined && v !== null && same(k, v)));

  /** { pins, keys, skipped }: the data in one shape. */
  function normalise(data) {
    const src = Array.isArray(data) ? { pins: data } : data && typeof data === "object" ? data : {};
    let skipped = 0;
    const pins = [];
    (Array.isArray(src.pins) ? src.pins : []).forEach((p, index) => {
      const lat = p && Number(p.lat);
      const lon = p && Number(p.lon !== undefined ? p.lon : p.lng);
      if (!p || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || p.lat === null || p.lat === "") {
        skipped += 1;
        return;
      }
      const xy = project(lon, lat);
      pins.push({ raw: p, index, id: p.id || "pin-" + index, label: String(p.label || p.title || "Place"), note: p.note, lat, lon, x: xy[0], y: xy[1] });
    });
    const keys = (Array.isArray(src.highlight) ? src.highlight : []).map((k) => (k && typeof k === "object" ? k.region : k)).filter((k) => k !== undefined && k !== null && k !== "").map(String);
    return { pins, keys, skipped };
  }

  /** The part of the canvas to show: the whole world, or a box round the pins and highlighted regions. */
  function viewBox(fit, pins, regions) {
    if (fit !== "content") return [0, 0, WIDTH, HEIGHT];
    const pts = pins.map((p) => [p.x, p.y]);
    regions.forEach((r) => (r.rings || []).forEach((ring) => ring.forEach((c) => pts.push(project(c[0], c[1])))));
    if (!pts.length) return [0, 0, WIDTH, HEIGHT];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const ratio = WIDTH / HEIGHT;
    let w = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 1) * 1.2 + 40;
    let hh = (Math.max(Math.max.apply(null, ys) - Math.min.apply(null, ys), 1) * 1.2 + 40) * ratio;
    w = Math.min(WIDTH, Math.max(w, hh, 200));
    hh = w / ratio;
    const cx = (Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2;
    const cy = (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2;
    const x = Math.min(WIDTH - w, Math.max(0, cx - w / 2));
    const y = Math.min(HEIGHT - hh, Math.max(0, cy - hh / 2));
    return [x, y, w, hh];
  }

  function open(pin, opts) {
    if (opts.onSelect) return opts.onSelect(pin.raw, pin.index);
    const bridge = opts.kasten || root.kasten;
    if (pin.raw.id && bridge) bridge.open(pin.raw.id).catch(() => {});
  }

  function summary(pins, names, hasWorld) {
    const where = pins.map((p) => p.label + " (" + p.lat.toFixed(1) + ", " + p.lon.toFixed(1) + ")").join("; ");
    return (pins.length ? pins.length + (pins.length === 1 ? " place: " : " places: ") + where + ". " : "No places. ") + (names.length ? "Highlighted: " + names.join(", ") + "." : "") + (hasWorld ? "" : " The world outline is not loaded.");
  }

  function pinView(pin, vb, opts, api, labelled) {
    const s = vb[2] / WIDTH;
    const flip = pin.x > vb[0] + vb[2] * 0.78;
    return h(
      "g.kit-pin",
      { key: pin.id, "data-active": api._active === pin.id ? "true" : null, transform: "translate(" + fix(pin.x) + " " + fix(pin.y) + ")", onMouseEnter: () => setActive(api, pin.id), onMouseLeave: () => setActive(api, null), onClick: () => open(pin, opts) },
      h("circle.kit-pin-dot", { r: fix(6 * s) }),
      labelled || api._active === pin.id ? h("text.kit-pin-label", { x: fix((flip ? -10 : 10) * s), y: fix(4 * s), "text-anchor": flip ? "end" : "start", style: { "font-size": fix(16 * s) + "px" } }, pin.label) : null,
    );
  }

  function setActive(api, id) {
    if (api._active === id) return;
    api._active = id;
    api.redraw();
  }

  kit.defineComponent("map", {
    defaults: { fit: "world", labels: "auto", list: true },
    view(data, opts, api) {
      const { pins, keys, skipped } = normalise(data);
      const world = opts.world || maps.world;
      const regions = world ? world.regions.filter((r) => isOn(r, keys)) : [];
      if (!pins.length && !keys.length) return kit.emptyView(opts.empty || "No places yet.");
      const vb = viewBox(opts.fit, pins, regions);
      const labelled = opts.labels === true || (opts.labels === "auto" && pins.length <= 12);
      const names = world ? regions.map((r) => r.name || r.id).filter((n, i, all) => all.indexOf(n) === i) : keys;
      const name = opts.label || "Map";
      const svg = h(
        "svg.kit-svg.kit-map-svg",
        { viewBox: vb.map(fix).join(" "), role: "img", "aria-label": name },
        h("title", {}, name),
        h("desc", {}, summary(pins, keys.length && world ? names : keys, !!world)),
        world
          ? h(
              "g.kit-map-land",
              {},
              world.regions.filter((r) => !isOn(r, keys)).map((r) => h("path.kit-region", { key: r.id || r.name, d: pathOf(r), "fill-rule": "evenodd" })),
              regions.map((r) => h("path.kit-region", { key: "on-" + (r.id || r.name), d: pathOf(r), "data-on": "true", "fill-rule": "evenodd" }, h("title", {}, r.name || r.id))),
            )
          : h("rect.kit-map-blank", { x: 0, y: 0, width: WIDTH, height: HEIGHT }),
        pins.map((p) => pinView(p, vb, opts, api, labelled)),
      );
      const list =
        opts.list && pins.length
          ? h(
              "ul.kit-map-list",
              { role: "list", "aria-label": (opts.label || "Map") + " places" },
              pins.map((p) => {
                const body = [h("strong", {}, p.label), p.note ? h("span.kit-muted", {}, p.note) : null];
                const clickable = !!opts.onSelect || !!p.raw.id;
                const events = { onMouseEnter: () => setActive(api, p.id), onMouseLeave: () => setActive(api, null) };
                return h(
                  "li",
                  { key: p.id, "data-active": api._active === p.id ? "true" : null },
                  clickable
                    ? h("button.kit-map-item", Object.assign({ type: "button", "data-roving": "", onFocus: () => setActive(api, p.id), onBlur: () => setActive(api, null), onClick: () => open(p, opts) }, events), body)
                    : h("div.kit-map-item", events, body),
                );
              }),
            )
          : null;
      return h("div.kit-map-wrap", { "data-list": list ? "true" : null }, svg, list, skipped ? h("p.kit-muted.kit-map-note", {}, skipped + (skipped === 1 ? " place has" : " places have") + " no usable position and " + (skipped === 1 ? "is" : "are") + " not shown.") : null);
    },
    after(el, opts, api) {
      if (api._roving) api._roving.refresh();
      else api._roving = kit.keys.roving(el, { orientation: "vertical" });
    },
    teardown(api) {
      if (api._roving) api._roving.destroy();
    },
  });
})(window);
