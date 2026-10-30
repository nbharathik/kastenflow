/* KastenFlow smart kit: calendar. One month as a grid, with the items of each
   day, and buttons for the previous month, the next month and today. Load after
   kit.js, lib/dom.js, lib/dates.js, lib/keys.js, and add kit-visual.css.

   Data: [{ title, date, end?, id? }]  (an item with an end shows on every day in between)
   Options: month ("YYYY-MM", default this month), weekStart (0 Sunday, 1 Monday; default 1),
   maxPerDay (default 3), onSelect(item, index), now, label, empty. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;
  const D = kit.dates;
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const MAX_SPAN = 62;

  /** "2027-03" plus n months. */
  function shift(ym, n) {
    const y = +ym.slice(0, 4);
    const m = +ym.slice(5, 7) - 1 + n;
    return y + Math.floor(m / 12) + "-" + pad((((m % 12) + 12) % 12) + 1);
  }
  const monthOf = (iso) => iso.slice(0, 7);

  /** Days of the month with their items: { iso, day, items }. */
  function byDay(data) {
    const map = {};
    (Array.isArray(data) ? data : []).forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const first = D.dateInfo(raw.date).iso;
      if (!first) return;
      const last = D.dateInfo(raw.end).iso;
      const span = last && D.compareDates(last, first) > 0 ? Math.min(MAX_SPAN, D.daysUntil(last, first)) : 0;
      for (let i = 0; i <= span; i++) {
        const iso = D.addDays(first, i);
        (map[iso] = map[iso] || []).push({ raw, index, title: String(raw.title || "Untitled") });
      }
    });
    return map;
  }

  function open(entry, opts) {
    if (opts.onSelect) return opts.onSelect(entry.raw, entry.index);
    const bridge = opts.kasten || root.kasten;
    if (entry.raw.id && bridge) bridge.open(entry.raw.id).catch(() => {});
  }

  function dayCell(iso, entries, today, opts) {
    const shown = entries.slice(0, opts.maxPerDay);
    const more = entries.length - shown.length;
    const items = shown.map((e, i) =>
      h("li.kit-cal-item", { key: iso + i }, e.raw.id || opts.onSelect ? h("button.kit-link", { type: "button", "data-roving": "", onClick: () => open(e, opts) }, e.title) : h("span", {}, e.title)),
    );
    if (more > 0) items.push(h("li.kit-muted", { key: "more" }, "+" + more + " more"));
    return h(
      "td.kit-cal-day-cell",
      { key: iso, "data-today": iso === today ? "true" : null, "data-busy": entries.length ? "true" : null },
      h("div.kit-cal-num", { "aria-current": iso === today ? "date" : null }, h("span", { "aria-hidden": "true" }, String(+iso.slice(8))), h("span.kit-sr", {}, D.formatDate(iso, opts) + (entries.length ? ", " + entries.length + (entries.length === 1 ? " item" : " items") : ""))),
      items.length ? h("ul.kit-cal-items", { role: "list" }, items) : null,
    );
  }

  kit.defineComponent("calendar", {
    defaults: { weekStart: 1, maxPerDay: 3 },
    tick: 3600000,
    view(data, options, api) {
      const now = typeof options.now === "function" ? options.now() : options.now;
      const opts = Object.assign({}, options, { now });
      const today = D.isoDate(now ? new Date(now) : new Date());
      if (api._optMonth !== options.month) {
        api._optMonth = options.month;
        api._month = null; // the page asked for a month: show it
      }
      const month = api._month || (/^\d{4}-\d{2}$/.test(options.month || "") ? options.month : monthOf(today));
      const [y, m] = [+month.slice(0, 4), +month.slice(5, 7)];
      const days = byDay(data);
      const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - opts.weekStart + 7) % 7;
      const count = D.daysInMonth(y, m);
      const weeks = Math.ceil((lead + count) / 7);
      const go = (n) => () => {
        api._month = n === 0 ? monthOf(today) : shift(month, n);
        api.redraw();
      };
      const names = [];
      for (let i = 0; i < 7; i++) {
        const iso = D.addDays("2027-02-07", i + opts.weekStart); // a Sunday
        names.push({ short: D.formatDate(iso, Object.assign({}, opts, { format: { weekday: "short", day: undefined, month: undefined, year: undefined } })), full: D.formatDate(iso, Object.assign({}, opts, { format: { weekday: "long", day: undefined, month: undefined, year: undefined } })) });
      }
      const title = D.formatDate(month + "-01", Object.assign({}, opts, { format: { month: "long", day: undefined } }));
      const rows = [];
      for (let w = 0; w < weeks; w++) {
        const cells = [];
        for (let d = 0; d < 7; d++) {
          const n = w * 7 + d - lead + 1;
          cells.push(n < 1 || n > count ? h("td.kit-cal-pad", { key: "p" + d }) : dayCell(month + "-" + pad(n), days[month + "-" + pad(n)] || [], today, opts));
        }
        rows.push(h("tr", { key: "w" + w }, cells));
      }
      return h(
        "div.kit-cal",
        {},
        h(
          "div.kit-row.kit-cal-nav",
          {},
          h("button.kit-btn", { type: "button", "aria-label": "Previous month", onClick: go(-1) }, "‹"),
          h("h3.kit-cal-title", { "aria-live": "polite" }, title),
          h("button.kit-btn", { type: "button", "aria-label": "Next month", onClick: go(1) }, "›"),
          h("button.kit-btn", { type: "button", onClick: go(0) }, "Today"),
        ),
        h(
          "table.kit-cal-table",
          {},
          h("caption.kit-sr", {}, (opts.label || "Calendar") + ", " + title),
          h("thead", {}, h("tr", {}, names.map((n) => h("th", { key: n.full, scope: "col", abbr: n.full }, n.short)))),
          h("tbody", {}, rows),
        ),
        Object.keys(days).some((k) => k.startsWith(month)) ? null : h("p.kit-muted.kit-cal-none", { role: "status" }, opts.empty || "Nothing scheduled this month."),
      );
    },
    after(el, opts, api) {
      if (api._roving) api._roving.refresh();
      else api._roving = kit.keys.roving(el, { orientation: "both" });
    },
    teardown(api) {
      if (api._roving) api._roving.destroy();
    },
  });
})(window);
