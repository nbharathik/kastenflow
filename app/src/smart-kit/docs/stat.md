# stat

Tiles with one big number each. Needs `lib/dom.js`, `lib/format.js`, `components/stat.js` (and `components/charts.js` for trends).

Data: `[{ label, value, delta?, hint?, spark?, format?, id? }]`

- `value` is a number (formatted with thousands separators) or text. `format(value)` overrides.
- `delta` is a change: shown with a sign, green when it is the good direction. `goodIsUp: false` flips that (for costs). Screen readers hear "up 5" or "down 2".
- `spark` is a list of numbers drawn as a small trend line.
- Options: `label`, `goodIsUp`, `empty`.

## Example

```js
kit.components.stat(document.getElementById("app"), {
  label: "Reading",
  data: [
    { label: "Papers read", value: 42, delta: 5, spark: [3, 5, 4, 8, 9] },
    { label: "Unread", value: 17, delta: -2, hint: "since Monday" },
  ],
});
```
