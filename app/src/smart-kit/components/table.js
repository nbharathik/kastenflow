/* KastenFlow smart kit: table. Load after kit.js, lib/dom.js, lib/format.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;

  const titleCase = (key) => String(key).replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

  /** Columns from the options, else from the keys of the first row. */
  function columnsOf(rows, opts) {
    if (Array.isArray(opts.columns) && opts.columns.length) return opts.columns.map((c) => (typeof c === "string" ? { key: c, label: titleCase(c) } : c));
    return Object.keys(rows[0] || {}).map((k) => ({ key: k, label: titleCase(k) }));
  }

  function cellText(col, row) {
    const v = row[col.key];
    if (col.format) return col.format(v, row);
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return kit.format.number(v, { digits: Number.isInteger(v) ? 0 : 2 });
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }

  function compare(a, b) {
    const x = a === undefined || a === null ? "" : a;
    const y = b === undefined || b === null ? "" : b;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
  }

  function sortRows(rows, sort) {
    if (!sort) return rows;
    const sign = sort.dir === "desc" ? -1 : 1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((p, q) => sign * compare(p.row[sort.key], q.row[sort.key]) || p.i - q.i)
      .map((p) => p.row);
  }

  function header(col, opts, api) {
    const sortable = col.sortable === undefined ? opts.sortable !== false : col.sortable;
    const s = api.sort;
    const dir = s && s.key === col.key ? s.dir : null;
    const label = col.label === undefined ? titleCase(col.key) : col.label;
    const th = { scope: "col", "data-align": col.align || null, "aria-sort": sortable ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : null };
    if (!sortable) return h("th", th, label);
    const next = dir === "asc" ? "desc" : dir === "desc" ? null : "asc";
    return h("th", th, h("button.kit-th-btn", { type: "button", "aria-label": "Sort by " + label, onClick: () => api.setSort(next && { key: col.key, dir: next }) }, label));
  }

  kit.defineComponent("table", {
    view(data, opts, api) {
      const rows = (Array.isArray(data) ? data : []).filter((r) => r && typeof r === "object");
      if (!rows.length) return kit.emptyView(opts.empty || "No rows yet.");
      const cols = columnsOf(rows, opts);
      const shown = sortRows(rows, api.sort);
      const first = cols[0];
      return h(
        "div.kit-table-wrap",
        {},
        h(
          "table.kit-table",
          {},
          h("caption.kit-sr", {}, opts.label || "Table"),
          h("thead", {}, h("tr", {}, cols.map((c) => header(c, opts, api)))),
          h(
            "tbody",
            {},
            shown.map((row, i) =>
              h(
                "tr",
                { key: row.id !== undefined ? String(row.id) : undefined },
                cols.map((c) => {
                  const text = cellText(c, row);
                  const link = opts.onRowClick && c === first && text !== "";
                  return h("td", { "data-align": c.align || null }, link ? h("button.kit-link", { type: "button", onClick: () => opts.onRowClick(row, i) }, text) : text);
                }),
              ),
            ),
          ),
        ),
      );
    },
    init(api, opts) {
      api.sort = opts.sort || null;
      api.setSort = (s) => {
        api.sort = s;
        api.redraw();
      };
    },
  });
})(window);
