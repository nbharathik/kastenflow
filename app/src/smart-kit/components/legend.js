/* KastenFlow smart kit: legend. Load after kit.js, lib/dom.js, lib/format.js.
   Items: { label, color?, value?, hidden?, id? }. `color` is a series number 1-8
   or a name (accent, success, warning, danger, favourite, muted); by default the
   item's position picks the series, so a legend matches a chart drawn from the same list. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;

  /** The legend's description, for components that draw one (the charts). */
  function legendView(items, opts) {
    const o = opts || {};
    const rows = items.map((it, i) => {
      const color = it.color === undefined ? i + 1 : it.color;
      const swatch = h("span.kit-swatch", { style: { "--kit-swatch": kit.format.seriesColor(color) }, "data-shape": o.shape || null, "aria-hidden": "true" });
      const value = it.value === undefined || it.value === null ? null : h("span.kit-legend-value", {}, typeof it.value === "number" ? kit.format.number(it.value, { digits: Number.isInteger(it.value) ? 0 : 1 }) : String(it.value));
      if (o.toggle) {
        const on = !it.hidden;
        return h("li", { key: it.id }, h("button.kit-legend-item", { type: "button", "aria-pressed": on ? "true" : "false", onClick: () => o.onToggle && o.onToggle(it, i) }, swatch, h("span", {}, it.label), value));
      }
      return h("li.kit-legend-item", { key: it.id }, swatch, h("span", {}, it.label), value);
    });
    return h("ul.kit-legend", { role: "list", "aria-label": o.label || "Legend" }, rows);
  }
  kit.legendView = legendView;

  kit.defineComponent("legend", {
    view(data, opts) {
      const items = (Array.isArray(data) ? data : []).filter((x) => x && typeof x.label === "string");
      return items.length ? legendView(items, opts) : kit.emptyView(opts.empty || "Nothing to label.");
    },
  });
})(window);
