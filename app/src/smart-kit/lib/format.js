/* KastenFlow smart kit: small formatting helpers. Load after kit.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const NAMED = { accent: 1, success: 2, warning: 3, danger: 4, favourite: 5, muted: 7 };

  /** 1234.5 -> "1,235"; digits sets the decimals. */
  function number(n, options) {
    if (typeof n !== "number" || !isFinite(n)) return "–";
    const d = options && options.digits !== undefined ? options.digits : 0;
    return new Intl.NumberFormat((options && options.locale) || "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  }
  /** 12400 -> "12.4K". */
  function compact(n, options) {
    if (typeof n !== "number" || !isFinite(n)) return "–";
    return new Intl.NumberFormat((options && options.locale) || "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  /** A ratio as a percentage: 0.256 -> "26%". */
  const percent = (ratio, digits) => (typeof ratio === "number" && isFinite(ratio) ? number(ratio * 100, { digits: digits || 0 }) + "%" : "–");
  /** "+5", "-2", "0". */
  function signed(n, options) {
    if (typeof n !== "number" || !isFinite(n)) return "–";
    return (n > 0 ? "+" : n < 0 ? "−" : "") + number(Math.abs(n), options);
  }
  const plural = (n, one, many) => number(n) + " " + (n === 1 ? one : many || one + "s");
  function truncate(text, max) {
    const s = String(text);
    return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
  }
  /**
   * The CSS colour for series `i` (1-8, wrapping) or a named kit colour
   * (accent, success, warning, danger, favourite, muted). Never a raw colour.
   */
  function seriesColor(i) {
    const n = typeof i === "string" && NAMED[i] ? NAMED[i] : typeof i === "number" ? ((((Math.round(i) - 1) % 8) + 8) % 8) + 1 : 1;
    return "var(--kit-series-" + n + ")";
  }
  const seriesIndex = (i) => (typeof i === "string" && NAMED[i] ? NAMED[i] : typeof i === "number" ? ((((Math.round(i) - 1) % 8) + 8) % 8) + 1 : 1);

  kit.format = { number, compact, percent, signed, plural, truncate, seriesColor, seriesIndex };
})(window);
