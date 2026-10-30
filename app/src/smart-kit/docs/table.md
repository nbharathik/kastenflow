# table

A sortable table. Needs `lib/dom.js`, `lib/format.js`, `components/table.js`.

Data: `[{ ...columns }]` (rows are plain objects; `id` makes a row stable across updates).

- `columns`: `["name", "due"]` or `[{ key, label?, align?: "left"|"right"|"center", format?: (value, row) => text, sortable? }]`. Without it, the first row's keys are used.
- Column headers are buttons: click or press Enter to sort ascending, again for descending, again to clear. `aria-sort` follows. Numbers sort as numbers, text with natural order.
- `onRowClick(row, index)` turns the first column's text into a button.
- Options: `label` (the table's caption, read aloud), `sortable: false`, `sort: { key, dir }`, `empty`.

## Example

```js
kit.components.table(document.getElementById("app"), {
  label: "Papers",
  columns: ["title", { key: "pages", align: "right" }],
  data: [
    { id: 1, title: "Beta", pages: 12 },
    { id: 2, title: "Alpha", pages: 8 },
  ],
});
```
