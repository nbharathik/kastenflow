# sparkline

A tiny trend line to sit inside text or a tile. Needs `lib/dom.js`, `lib/format.js`, `components/charts.js`.

Data: `[numbers]`. Its accessible name says where the trend starts and ends, and its low and high. `label` names the thing measured (default "Trend"). No data shows a dash.

## Example

```js
kit.components.sparkline(document.getElementById("app"), { label: "Pages a day", data: [3, 5, 4, 8, 9, 7] });
```
