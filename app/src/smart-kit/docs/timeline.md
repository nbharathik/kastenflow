# timeline

Lanes of dated points and date ranges on one time axis, with a line for today: the
deadline to conference pipeline at a glance. Needs `lib/dom.js`, `lib/dates.js`,
`lib/keys.js`, `components/timeline.js` and `kit-visual.css`.

Data: `[{ title, date | start + end, lane?, announced?, aoe?, id? }]`

- `date` (a point) or `start` and `end` (a range) are `"YYYY-MM-DD"`. Items without a readable date are left out and one line says how many.
- `lane` groups items in a row; lanes appear in the order they first show up, or as listed in the `lanes` option.
- `announced: false` marks an estimate: the marker is hollow (a range is dashed) and its name says "(estimated)".
- Options: `label` (accessible name), `lanes`, `from` and `to` (the days shown; default: all items with a few days of room), `today: false` (no today line), `now` (a Date, for tests), `onSelect(item, index)`, `empty`.
- Labels that would overlap move to their own row inside the lane.
- An item with an `id` is a button that opens the note (or calls `onSelect`); arrow keys move between items. Every item has an accessible name such as "Paper: Feb 24, 2027 (estimated), in 4 days".

## Example

```js
kit.components.timeline(document.getElementById("app"), {
  label: "Conference pipeline",
  data: [
    { lane: "NeurIPS", title: "Abstract", date: "2027-05-10" },
    { lane: "NeurIPS", title: "Paper", date: "2027-05-17", aoe: true },
    { lane: "NeurIPS", title: "Notification", date: "2027-09-25", announced: false },
    { lane: "NeurIPS", title: "Conference", start: "2027-12-06", end: "2027-12-12", announced: false },
    { lane: "CHI", title: "Camera-ready", date: "2027-03-01" },
  ],
});
```
