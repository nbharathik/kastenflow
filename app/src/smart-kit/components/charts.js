/* KastenFlow smart kit: simple SVG charts (bar, line, donut, sparkline). Colours
   are the kit's series tokens, never raw values. Each chart is an image with an
   accessible name and a text summary of its values. Load after kit.js,
   lib/dom.js, lib/format.js and components/legend.js.

   Data (bar, line): [{ label, value }] | [numbers] |
                     { labels: [...], series: [{ name, values: [...] }] }
   Data (donut): [{ label, value }]      Data (sparkline): [numbers] */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;
  const F = kit.format;
  const fix = (n) => +n.toFixed(2);

  /** {labels, series:[{name, values}]} from any accepted shape; null when there is nothing to draw. */
  function normalize(data) {
    let labels;
    let series;
    if (Array.isArray(data)) {
      const items = data.filter((d) => (typeof d === "number" && isFinite(d)) || (d && typeof d === "object" && isFinite(d.value)));
      labels = items.map((d, i) => (typeof d === "object" && d.label !== undefined ? String(d.label) : String(i + 1)));
      series = [{ name: "", values: items.map((d) => (typeof d === "number" ? d : d.value)) }];
    } else if (data && Array.isArray(data.series) && Array.isArray(data.labels)) {
      labels = data.labels.map(String);
      series = data.series.map((s, i) => ({ name: String((s && s.name) || "Series " + (i + 1)), values: labels.map((_, j) => (s && isFinite(s.values && s.values[j]) ? s.values[j] : 0)) }));
    } else return null;
    return labels.length && series.length ? { labels, series } : null;
  }

  /** Axis limits and ticks that land on 1, 2 or 5 times a power of ten. */
  function niceScale(min, max) {
    let lo = Math.min(0, min);
    let hi = Math.max(0, max);
    if (hi === lo) hi = lo + 1;
    const raw = (hi - lo) / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks };
  }

  const kindName = { bar: "Bar chart", line: "Line chart", donut: "Donut chart", sparkline: "Trend" };
  function summary(kind, n) {
    const rows = n.series.map((s) => (s.name ? s.name + ": " : "") + n.labels.map((l, i) => l + " " + F.number(s.values[i], { digits: Number.isInteger(s.values[i]) ? 0 : 1 })).join(", "));
    return kindName[kind] + ", " + n.labels.length + (n.labels.length === 1 ? " point. " : " points. ") + rows.join(". ");
  }

  function frame(kind, opts, n, W, H, body) {
    const name = opts.label || kindName[kind];
    return h("svg.kit-svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": name }, h("title", {}, name), h("desc", {}, summary(kind, n)), body);
  }

  /** Axes shared by bar and line: returns { body, y, plot }. */
  function axes(n, opts, W, H) {
    const plot = { l: 44, r: 8, t: 8, b: 28 };
    plot.w = W - plot.l - plot.r;
    plot.h = H - plot.t - plot.b;
    const all = n.series.reduce((a, s) => a.concat(s.values), []);
    const sc = niceScale(Math.min.apply(null, all), Math.max.apply(null, all));
    const y = (v) => fix(plot.t + plot.h * (1 - (v - sc.lo) / (sc.hi - sc.lo)));
    const every = Math.max(1, Math.ceil(n.labels.length / Math.max(1, Math.floor(plot.w / 44))));
    return {
      plot,
      y,
      zero: y(0),
      body: [
        sc.ticks.map((t) => [
          h("line.kit-grid-line", { x1: plot.l, x2: W - plot.r, y1: y(t), y2: y(t) }),
          h("text.kit-tick", { x: plot.l - 6, y: y(t) + 3, "text-anchor": "end" }, F.compact(t)),
        ]),
        h("line.kit-axis", { x1: plot.l, x2: W - plot.r, y1: y(0), y2: y(0) }),
        n.labels.map((l, i) => (i % every ? null : h("text.kit-tick", { x: fix(n.centre(i, plot)), y: H - 10, "text-anchor": "middle" }, F.truncate(l, 12)))),
      ],
    };
  }

  const withLegend = (chart, n, opts) =>
    n.series.length > 1 && opts.legend !== false ? h("div.kit-chart", {}, chart, kit.legendView(n.series.map((s) => ({ label: s.name })), { label: "Series" })) : h("div.kit-chart", {}, chart);

  function barView(data, opts) {
    const o = opts || {};
    const n = normalize(data);
    if (!n) return kit.emptyView(o.empty || "No data to chart.");
    const W = o.width || 480;
    const H = o.height || 240;
    n.centre = (i, p) => p.l + (p.w / n.labels.length) * (i + 0.5);
    const ax = axes(n, o, W, H);
    const gw = ax.plot.w / n.labels.length;
    const bw = (gw * 0.7) / n.series.length;
    const bars = n.series.map((s, si) =>
      s.values.map((v, i) => {
        const y = ax.y(v);
        const x = ax.plot.l + gw * i + gw * 0.15 + bw * si;
        const text = (n.series.length > 1 ? s.name + ", " : "") + n.labels[i] + ": " + F.number(v, { digits: Number.isInteger(v) ? 0 : 1 });
        return h(`rect.kit-bar.kit-fill.kit-s${F.seriesIndex(si + 1)}`, { x: fix(x), y: Math.min(y, ax.zero), width: fix(bw), height: Math.abs(fix(ax.zero - y)), rx: 2 }, h("title", {}, text));
      }),
    );
    return withLegend(frame("bar", o, n, W, H, [ax.body, bars]), n, o);
  }

  function lineView(data, opts) {
    const o = opts || {};
    const n = normalize(data);
    if (!n) return kit.emptyView(o.empty || "No data to chart.");
    const W = o.width || 480;
    const H = o.height || 240;
    n.centre = (i, p) => (n.labels.length === 1 ? p.l + p.w / 2 : p.l + (p.w * i) / (n.labels.length - 1));
    const ax = axes(n, o, W, H);
    const lines = n.series.map((s, si) => {
      const cls = `kit-s${F.seriesIndex(si + 1)}`;
      const pts = s.values.map((v, i) => [fix(n.centre(i, ax.plot)), ax.y(v)]);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
      return [
        pts.length > 1 ? h(`path.kit-line.kit-stroke.${cls}`, { d, pathLength: 1000 }) : null,
        pts.map((p, i) => h(`circle.kit-dot.${cls}`, { cx: p[0], cy: p[1], r: 3 }, h("title", {}, (n.series.length > 1 ? s.name + ", " : "") + n.labels[i] + ": " + F.number(s.values[i], { digits: Number.isInteger(s.values[i]) ? 0 : 1 })))),
      ];
    });
    return withLegend(frame("line", o, n, W, H, [ax.body, lines]), n, o);
  }

  function donutView(data, opts) {
    const o = opts || {};
    const items = (Array.isArray(data) ? data : []).filter((d) => d && isFinite(d.value) && d.value > 0);
    const total = items.reduce((a, d) => a + d.value, 0);
    if (!items.length) return kit.emptyView(o.empty || "No data to chart.");
    let at = 0;
    const segs = items.map((d, i) => {
      const pct = (d.value / total) * 100;
      const el = h(`circle.kit-donut-seg.kit-stroke.kit-s${F.seriesIndex(i + 1)}`, { cx: 21, cy: 21, r: 15.9155, "stroke-dasharray": fix(pct) + " " + fix(100 - pct), "stroke-dashoffset": fix(25 - at) }, h("title", {}, d.label + ": " + F.number(d.value, { digits: Number.isInteger(d.value) ? 0 : 1 }) + " (" + F.percent(d.value / total) + ")"));
      at += pct;
      return el;
    });
    const n = { labels: items.map((d) => String(d.label)), series: [{ name: "", values: items.map((d) => d.value) }] };
    const body = [h("circle.kit-donut-track", { cx: 21, cy: 21, r: 15.9155 }), segs, h("text.kit-center-label", { x: 21, y: 22.5, "text-anchor": "middle" }, F.compact(total)), o.centerLabel ? h("text.kit-center-sub", { x: 21, y: 27, "text-anchor": "middle" }, o.centerLabel) : null];
    const svg = h("svg.kit-svg", { viewBox: "0 0 42 42", role: "img", "aria-label": o.label || kindName.donut, style: { maxWidth: (o.size || 180) + "px" } }, h("title", {}, o.label || kindName.donut), h("desc", {}, summary("donut", n)), body);
    const legend = o.legend === false ? null : kit.legendView(items.map((d) => ({ label: String(d.label), value: F.percent(d.value / total) })), { label: "Slices" });
    return h("div.kit-chart", {}, svg, legend);
  }

  function sparklineView(values, opts) {
    const o = opts || {};
    const vals = (Array.isArray(values) ? values : []).map((v) => (v && typeof v === "object" ? v.value : v)).filter((v) => typeof v === "number" && isFinite(v));
    if (!vals.length) return h("span.kit-faint", {}, "–");
    const W = 120;
    const H = 32;
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => [fix(3 + ((W - 6) * (vals.length === 1 ? 0.5 : i / (vals.length - 1)))), fix(H - 3 - ((H - 6) * (v - min)) / span)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const last = pts[pts.length - 1];
    const name = (o.label || "Trend") + ": from " + F.number(vals[0], { digits: Number.isInteger(vals[0]) ? 0 : 1 }) + " to " + F.number(vals[vals.length - 1], { digits: Number.isInteger(vals[vals.length - 1]) ? 0 : 1 }) + ", low " + F.number(min) + ", high " + F.number(max);
    return h("svg.kit-svg.kit-spark", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": name }, h("title", {}, name), vals.length > 1 ? h("path.kit-line.kit-stroke.kit-s1", { d, pathLength: 1000 }) : null, h("circle.kit-dot.kit-s1", { cx: last[0], cy: last[1], r: 2.5 }));
  }

  kit.charts = { normalize, niceScale, barView, lineView, donutView, sparklineView };
  kit.defineComponent("bar", { view: (data, opts) => barView(data, opts) });
  kit.defineComponent("line", { view: (data, opts) => lineView(data, opts) });
  kit.defineComponent("donut", { view: (data, opts) => donutView(data, opts) });
  kit.defineComponent("sparkline", { view: (data, opts) => sparklineView(data, opts) });
})(window);
