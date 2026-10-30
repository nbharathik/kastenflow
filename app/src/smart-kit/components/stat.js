/* KastenFlow smart kit: stat tiles. Load after kit.js, lib/dom.js, lib/format.js
   (and components/charts.js for tiles with a `spark` trend). Tiles:
   { label, value, delta?, hint?, spark?: number[], format?: (v) => string }. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;
  const F = kit.format;

  function shown(tile) {
    if (tile.format) return tile.format(tile.value);
    if (typeof tile.value === "number") return F.number(tile.value, { digits: Number.isInteger(tile.value) ? 0 : 1 });
    return tile.value === undefined || tile.value === null ? "–" : String(tile.value);
  }

  function delta(tile, opts) {
    if (typeof tile.delta !== "number" || !isFinite(tile.delta)) return null;
    const up = tile.delta > 0;
    const good = tile.delta === 0 ? null : (up ? true : false) === (opts.goodIsUp !== false);
    const word = tile.delta === 0 ? "no change" : (up ? "up " : "down ") + F.number(Math.abs(tile.delta), { digits: Number.isInteger(tile.delta) ? 0 : 1 });
    return h("div.kit-stat-delta", { "data-tone": good === null ? null : good ? "good" : "bad" }, h("span", { "aria-hidden": "true" }, F.signed(tile.delta, { digits: Number.isInteger(tile.delta) ? 0 : 1 })), h("span.kit-sr", {}, word));
  }

  function tileView(tile, opts) {
    const value = shown(tile);
    const spark = Array.isArray(tile.spark) && kit.charts ? kit.charts.sparklineView(tile.spark, { label: tile.label + " trend" }) : null;
    return h(
      "li.kit-card.kit-stat",
      { key: tile.id !== undefined ? tile.id : tile.label, "aria-label": tile.label + ": " + value },
      h("div.kit-stat-label", {}, tile.label),
      h("div.kit-stat-value", {}, value),
      delta(tile, opts),
      spark,
      tile.hint ? h("div.kit-stat-hint", {}, tile.hint) : null,
    );
  }

  kit.defineComponent("stat", {
    view(data, opts) {
      const tiles = (Array.isArray(data) ? data : []).filter((t) => t && typeof t.label === "string");
      if (!tiles.length) return kit.emptyView(opts.empty || "No numbers yet.");
      return h("ul.kit-grid", { role: "list", "aria-label": opts.label || "Key numbers", style: { "--kit-min": "9rem" } }, tiles.map((t) => tileView(t, opts)));
    },
  });
})(window);
