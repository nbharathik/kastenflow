/* KastenFlow smart kit: kanban. Cards in columns by status. Load after kit.js,
   lib/dom.js, lib/keys.js, and add kit-visual.css.

   Data: [{ title, status, note?, tags?, id? }]
   Options: columns (names, or { key, label }), onSelect(item, index), onMove(item, status)
   (when onMove is given each card gets a "Move to" menu), label, empty. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;

  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  /** [{ key, label }] from the options, else the statuses in the order they first appear. */
  function columnsOf(items, opts) {
    let cols;
    if (Array.isArray(opts.columns) && opts.columns.length) {
      cols = opts.columns.map((c) => (typeof c === "string" ? { key: c, label: c } : { key: String(c.key), label: String(c.label || c.key) }));
      if (items.some((it) => !cols.some((c) => same(c.key, it.status)))) cols.push({ key: "", label: opts.otherLabel || "Other" });
    } else {
      cols = [];
      items.forEach((it) => {
        if (it.status && !cols.some((c) => same(c.key, it.status))) cols.push({ key: it.status, label: it.status });
      });
      if (items.some((it) => !it.status)) cols.push({ key: "", label: opts.otherLabel || "No status" });
    }
    return cols;
  }

  function open(item, index, opts) {
    if (opts.onSelect) return opts.onSelect(item, index);
    const bridge = opts.kasten || root.kasten;
    if (item.id && bridge) bridge.open(item.id).catch(() => {});
  }

  function card(entry, cols, opts) {
    const item = entry.item;
    const title = String(item.title || "Untitled");
    const clickable = !!opts.onSelect || !!item.id;
    const head = clickable ? h("button.kit-link.kit-kb-title", { type: "button", "data-roving": "", onClick: () => open(item, entry.index, opts) }, title) : h("strong.kit-kb-title", {}, title);
    const move = opts.onMove
      ? h(
          "select.kit-kb-move",
          { "aria-label": "Move " + title + " to", onChange: (e) => opts.onMove(item, e.target.value) },
          cols.map((c) => h("option", { key: c.key, value: c.key, selected: c.key === entry.col }, c.label)),
        )
      : null;
    const tags = Array.isArray(item.tags) && item.tags.length ? h("div.kit-row.kit-kb-tags", {}, item.tags.map((t) => h("span.kit-chip", { key: t }, String(t)))) : null;
    return h("li.kit-card.kit-kb-card", { key: item.id || "i" + entry.index }, head, item.note ? h("p.kit-muted", {}, item.note) : null, tags, move);
  }

  kit.defineComponent("kanban", {
    view(data, opts) {
      const items = (Array.isArray(data) ? data : []).filter((x) => x && typeof x === "object");
      if (!items.length) return kit.emptyView(opts.empty || "No cards yet.");
      const cols = columnsOf(items, opts);
      const entries = items.map((item, index) => {
        const at = cols.find((c) => c.key !== "" && same(c.key, item.status));
        return { item, index, col: at ? at.key : "" };
      });
      return h(
        "div.kit-kb",
        { role: "group", "aria-label": opts.label || "Board" },
        cols.map((c) => {
          const mine = entries.filter((e) => e.col === c.key);
          return h(
            "section.kit-kb-col",
            { key: "col-" + c.key, "aria-label": c.label + ", " + mine.length + (mine.length === 1 ? " card" : " cards") },
            h("h3.kit-kb-head", {}, c.label, h("span.kit-badge", {}, String(mine.length))),
            mine.length ? h("ul.kit-kb-list", { role: "list" }, mine.map((e) => card(e, cols, opts))) : h("p.kit-muted.kit-kb-none", {}, opts.emptyColumn || "Nothing here."),
          );
        }),
      );
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
