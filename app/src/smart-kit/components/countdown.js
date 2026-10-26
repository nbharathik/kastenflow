/* KastenFlow smart kit: countdown cards. Load after kit.js, lib/dom.js, lib/dates.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;
  const D = kit.dates;

  function stateOf(days) {
    if (days === null) return "unknown";
    if (days < 0) return "passed";
    if (days === 0) return "today";
    return days <= 7 ? "soon" : "later";
  }

  /** "5h 12m left" for an AoE deadline in its last day. */
  function aoeLeft(info, now) {
    if (!info.aoe || !info.iso) return "";
    const r = D.aoeRemaining(info.iso, now);
    if (!r || r.passed || r.days > 0) return "";
    return r.hours + "h " + r.minutes + "m left";
  }

  function card(item, opts) {
    const now = typeof opts.now === "function" ? opts.now() : opts.now;
    const info = D.dateInfo(item, { now, locale: opts.locale });
    const n = info.days;
    const big = n === null ? "?" : n === 0 ? "Today" : String(Math.abs(n));
    const unit = n === null || n === 0 ? "" : Math.abs(n) === 1 ? "day" : "days";
    const tail = n !== null && n < 0 ? "ago" : "";
    const left = aoeLeft(info, now);
    const words = D.describeDays(n);
    const aria = (item.title || "Untitled") + ": " + words + ", " + (info.label || "no date") + (info.announced ? "" : " (estimated)") + (info.aoe ? ", anywhere on Earth" : "");
    return h(
      "li.kit-card.kit-countdown-card",
      { "data-state": stateOf(n), "aria-label": aria, key: item.id },
      h("h3", {}, item.title || "Untitled"),
      h("div.kit-countdown-days", {}, big, unit || tail ? h("small", {}, [unit, tail].filter(Boolean).join(" ")) : null),
      h(
        "div.kit-countdown-date",
        {},
        h("span", {}, info.label || "No date"),
        info.iso ? h("span.kit-badge", { "data-kind": info.announced ? "announced" : "est" }, info.announced ? "Announced" : "Estimated") : null,
        info.aoe ? h("span.kit-badge", {}, "AoE") : null,
        left ? h("span", {}, left) : null,
      ),
      item.note ? h("p.kit-muted", {}, item.note) : null,
    );
  }

  kit.defineComponent("countdown", {
    tick: 60000,
    view(data, opts) {
      const list = (Array.isArray(data) ? data : []).filter((x) => x && typeof x === "object");
      if (!list.length) return kit.emptyView(opts.empty || "No dates yet.");
      const sorted = opts.sort === false ? list : list.slice().sort((a, b) => D.compareDates(D.dateInfo(a).iso, D.dateInfo(b).iso));
      return h("ul.kit-grid", { role: "list", "aria-label": opts.label || "Countdowns" }, sorted.map((x) => card(x, opts)));
    },
  });
})(window);
