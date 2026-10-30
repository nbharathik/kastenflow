/* KastenFlow smart kit: timeline. Lanes of dated points and date ranges on one
   time axis, with a line for today. Load after kit.js, lib/dom.js, lib/dates.js,
   lib/keys.js, and add kit-visual.css.

   Data: [{ title, date | start + end, lane?, announced?, aoe?, note?, id? }] */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;
  const D = kit.dates;
  const TRACK_PX = 640; // an assumed width, only used to keep labels from overlapping
  const PAD_DAYS = 3;
  const MIN_SPAN = 14;
  const ROW_REM = 2;

  /** Items that have a readable date (or range), in the shape the view draws. */
  function normalise(data) {
    const items = [];
    let skipped = 0;
    (Array.isArray(data) ? data : []).forEach((raw, i) => {
      if (!raw || typeof raw !== "object") return;
      const a = D.dateInfo({ date: raw.start !== undefined ? raw.start : raw.date, announced: raw.announced, status: raw.status });
      const b = raw.start !== undefined && raw.end !== undefined ? D.dateInfo(raw.end) : null;
      if (!a.iso) {
        skipped += 1;
        return;
      }
      const range = !!b && !!b.iso && D.compareDates(b.iso, a.iso) > 0;
      items.push({
        raw,
        index: i,
        id: raw.id,
        title: String(raw.title || "Untitled"),
        lane: raw.lane === undefined || raw.lane === null ? "" : String(raw.lane),
        start: a.iso,
        end: range ? b.iso : a.iso,
        range,
        announced: a.announced,
        aoe: raw.aoe === true,
        note: raw.note,
      });
    });
    return { items, skipped };
  }

  /** The first and last day shown, as "YYYY-MM-DD". */
  function bounds(items, opts, today) {
    let lo = items.reduce((m, x) => (D.compareDates(x.start, m) < 0 ? x.start : m), items[0].start);
    let hi = items.reduce((m, x) => (D.compareDates(x.end, m) > 0 ? x.end : m), items[0].end);
    const near = (iso) => D.daysUntil(iso, lo) > -120 && D.daysUntil(iso, hi) < 120;
    if (opts.today !== false && today && near(today)) {
      if (D.compareDates(today, lo) < 0) lo = today;
      if (D.compareDates(today, hi) > 0) hi = today;
    }
    lo = D.dateInfo(opts.from).iso || D.addDays(lo, -PAD_DAYS);
    hi = D.dateInfo(opts.to).iso || D.addDays(hi, PAD_DAYS);
    if (D.daysUntil(hi, lo) < MIN_SPAN) hi = D.addDays(lo, MIN_SPAN);
    return { lo, hi, span: D.daysUntil(hi, lo) };
  }

  const fraction = (iso, b) => Math.min(1, Math.max(0, D.daysUntil(iso, b.lo) / b.span));

  /** Month marks along the axis; every month, quarter or year depending on the span. */
  function ticks(b) {
    const step = b.span <= 430 ? 1 : b.span <= 900 ? 3 : 12;
    const out = [];
    const first = D.parseDate(b.lo);
    let y = first.getFullYear();
    let m = first.getMonth() + 1;
    for (let guard = 0; guard < 400; guard++) {
      const iso = y + "-" + (m < 10 ? "0" : "") + m + "-01";
      if (D.compareDates(iso, b.hi) > 0) break;
      if (D.compareDates(iso, b.lo) >= 0 && (m - 1) % step === 0) {
        out.push({ iso, f: fraction(iso, b), text: D.formatDate(iso, { format: step === 12 ? { month: undefined, day: undefined, year: "numeric" } : { day: undefined, year: "2-digit" } }) });
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  /** Give each item of one lane a row so labels do not overlap. Returns the number of rows. */
  function pack(items, b) {
    const ends = [];
    items
      .slice()
      .sort((p, q) => D.compareDates(p.start, q.start))
      .forEach((it) => {
        const left = fraction(it.start, b) * 100;
        const label = ((it.title.length * 6.5 + 24) / TRACK_PX) * 100;
        const right = Math.max(fraction(it.end, b) * 100, left + label);
        let row = ends.findIndex((e) => e < left - 0.5);
        if (row < 0) row = ends.length;
        ends[row] = right;
        it.row = row;
      });
    return Math.max(1, ends.length);
  }

  function describe(it, opts) {
    const range = it.range ? D.formatDate(it.start, opts) + " to " + D.formatDate(it.end, opts) : D.formatDate(it.start, opts);
    const est = it.announced ? "" : " (estimated)";
    const when = it.range ? "" : ", " + D.describeDays(D.daysUntil(it.start, opts.now));
    return it.title + ": " + range + est + when + (it.aoe ? ", anywhere on Earth" : "");
  }

  function open(it, opts) {
    if (opts.onSelect) return opts.onSelect(it.raw, it.index);
    const bridge = opts.kasten || root.kasten;
    if (it.id && bridge) bridge.open(it.id).catch(() => {});
  }

  function item(it, b, today, opts) {
    const f = fraction(it.start, b);
    const style = { "--x": f.toFixed(4), "--row": String(it.row) };
    if (it.range) style["--w"] = Math.max(0.01, fraction(it.end, b) - f).toFixed(4);
    const past = today && D.compareDates(it.end, today) < 0;
    const text = h("span.kit-tl-text", {}, it.title);
    const mark = it.range ? h("span.kit-tl-bar", {}) : h("span.kit-tl-dot", {});
    const clickable = !!opts.onSelect || !!it.id;
    const inner = clickable
      ? h("button.kit-tl-btn", { type: "button", "data-roving": "", "aria-label": describe(it, opts), onClick: () => open(it, opts) }, mark, text)
      : h("span.kit-tl-btn", {}, mark, text);
    return h("li.kit-tl-item", { key: it.index, style, "data-kind": it.range ? "range" : "point", "data-state": it.announced ? "announced" : "est", "data-when": past ? "past" : "later", "aria-label": clickable ? null : describe(it, opts) }, inner);
  }

  kit.defineComponent("timeline", {
    tick: 3600000,
    view(data, options) {
      const { items, skipped } = normalise(data);
      if (!items.length) return kit.emptyView(options.empty || "No dated items yet.");
      const now = typeof options.now === "function" ? options.now() : options.now;
      const opts = Object.assign({}, options, { now });
      const today = D.isoDate(now ? new Date(now) : new Date());
      const b = bounds(items, opts, today);
      const names = opts.lanes ? opts.lanes.map(String) : [];
      items.forEach((it) => {
        if (!names.includes(it.lane)) names.push(it.lane);
      });
      const lanes = names.map((name) => {
        const mine = items.filter((it) => it.lane === name);
        return { name, mine, rows: mine.length ? pack(mine, b) : 1 };
      });
      const showToday = opts.today !== false && D.compareDates(today, b.lo) >= 0 && D.compareDates(today, b.hi) <= 0;
      return h(
        "div.kit-tl",
        { role: "group", "aria-label": opts.label || "Timeline" },
        h("div.kit-tl-axis", {}, h("span.kit-tl-name", {}), h("div.kit-tl-ticks", { "aria-hidden": "true" }, ticks(b).map((t) => h("span.kit-tl-tick", { key: t.iso, style: { "--x": t.f.toFixed(4) } }, t.text)))),
        lanes.map((lane) =>
          h(
            "div.kit-tl-lane",
            { key: "lane-" + lane.name, role: "group", "aria-label": lane.name ? "Lane " + lane.name : "Events" },
            h("span.kit-tl-name", {}, lane.name),
            h("ul.kit-tl-track", { role: "list", style: { "--rows": String(lane.rows), "--row-h": ROW_REM + "rem" } }, lane.mine.map((it) => item(it, b, today, opts))),
          ),
        ),
        showToday ? h("div.kit-tl-today", { role: "img", "aria-label": "Today, " + D.formatDate(today, opts), style: { "--x": fraction(today, b).toFixed(4) } }, h("span", {}, "Today")) : null,
        skipped ? h("p.kit-muted.kit-tl-note", {}, skipped + (skipped === 1 ? " item has" : " items have") + " no date and " + (skipped === 1 ? "is" : "are") + " not shown.") : null,
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
