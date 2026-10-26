# bar

A bar chart. Needs `lib/dom.js`, `lib/format.js`, `components/legend.js`, `components/charts.js`.

Data: `[{ label, value }]`, or `{ labels: [...], series: [{ name, values: [...] }] }` for grouped bars (a legend appears).

- The chart is an image named by `label`; its `desc` lists every value, and each bar has a tooltip.
- Axis steps are 1, 2 or 5 times a power of ten; negative values hang below the zero line.
- Options: `label`, `width`/`height` (the drawing's size; the chart still fits its container), `legend: false`, `empty`.
- Bars grow in when motion is allowed and just appear with reduced motion.

## Example

```js
kit.components.bar(document.getElementById("app"), {
  label: "Papers per month",
  data: [
    { label: "Jan", value: 4 },
    { label: "Feb", value: 9 },
    { label: "Mar", value: 6 },
  ],
});
```
