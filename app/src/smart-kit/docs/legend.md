# legend

Colour keys for charts. Needs `lib/dom.js`, `lib/format.js`, `components/legend.js`.

Data: `[{ label, color?, value?, hidden?, id? }]`

- `color` is a series number 1 to 8 or a name (`accent`, `success`, `warning`, `danger`, `favourite`, `muted`). Left out, the item's place picks the series, matching the charts. Raw colours are not accepted.
- `toggle: true` makes each item a button with `aria-pressed`; `onToggle(item, index)` runs on a click. Keep `hidden` in your own state and pass the new data.
- Options: `label`, `shape: "dot"`, `empty`.

## Example

```js
kit.components.legend(document.getElementById("app"), {
  label: "Status",
  data: [
    { label: "Done", color: "success", value: 12 },
    { label: "Late", color: "danger", value: 3 },
  ],
});
```
