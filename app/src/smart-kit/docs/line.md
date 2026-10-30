# line

A line chart with one or more series. Needs the same files as `bar`.

Data: `[{ label, value }]`, `[numbers]`, or `{ labels: [...], series: [{ name, values: [...] }] }`.

- Same options as `bar`. Each point has a tooltip and the `desc` lists all values. One point draws a dot only.

## Example

```js
kit.components.line(document.getElementById("app"), {
  label: "Words written",
  data: {
    labels: ["Mon", "Tue", "Wed"],
    series: [
      { name: "Draft", values: [200, 450, 380] },
      { name: "Notes", values: [90, 120, 300] },
    ],
  },
});
```
