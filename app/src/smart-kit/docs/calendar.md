# calendar

One month as a grid, with the items of each day and buttons for the previous
month, the next month and today. Needs `lib/dom.js`, `lib/dates.js`, `lib/keys.js`,
`components/calendar.js` and `kit-visual.css`.

Data: `[{ title, date, end?, id? }]`

- An item with an `end` shows on every day from `date` to `end`.
- Options: `month` (`"YYYY-MM"`, default this month; set it with `setOptions` to jump), `weekStart` (`1` Monday, the default, or `0` Sunday), `maxPerDay` (default 3; the rest read "+2 more"), `label`, `onSelect(item, index)`, `now`, `empty` (the sentence for a month with nothing in it).
- The grid is a real table: column headers carry the full weekday name, each day carries its full date and item count for screen readers, and today is marked with `aria-current="date"`.
- An item with an `id` is a button that opens the note (or calls `onSelect`).

## Example

```js
kit.components.calendar(document.getElementById("app"), {
  label: "Events",
  month: "2027-03",
  data: [
    { title: "Camera-ready", date: "2027-03-03" },
    { title: "Workshop", date: "2027-03-10", end: "2027-03-12" },
  ],
});
```
