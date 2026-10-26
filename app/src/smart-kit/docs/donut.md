# donut

A donut chart with a legend of shares. Needs the same files as `bar`.

Data: `[{ label, value }]` (zero and negative values are left out; the middle shows the total).

- Options: `label`, `centerLabel` (small text under the total), `size` (max width in px, default 180), `legend: false`, `empty`.

## Example

```js
kit.components.donut(document.getElementById("app"), {
  label: "Tasks by state",
  centerLabel: "tasks",
  data: [
    { label: "Open", value: 6 },
    { label: "Done", value: 14 },
  ],
});
```
