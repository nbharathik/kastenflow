# countdown

Cards that count the days to each date. Needs `lib/dom.js`, `lib/dates.js`, `components/countdown.js`.

Data: `[{ title, date, announced?, aoe?, note?, id? }]`

- `date` is `"YYYY-MM-DD"`. `announced: false` marks an estimate: the card says "est." and an Estimated badge. A bare date counts as announced.
- `aoe: true` is a deadline "anywhere on Earth": it ends at 23:59:59 in UTC-12, so on its last day the card shows the hours and minutes left.
- Options: `label` (the list's accessible name), `sort: false` (keep the given order), `now` (a Date, for tests), `tick` (ms between clock redraws, default 60000, `0` turns it off), `empty`.
- Each card has an accessible name such as "Camera-ready: in 12 days, Mar 3, 2027 (estimated)". Passed dates are dimmed and say "ago".

## Example

```js
kit.components.countdown(document.getElementById("app"), {
  label: "Deadlines",
  data: [
    { title: "Abstract", date: "2027-03-01", announced: true, aoe: true },
    { title: "Notification", date: "2027-05-15", announced: false },
  ],
});
```
