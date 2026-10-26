# Tracker

Deadlines and dates from your notes on one timeline, with countdowns to the next
ones and cards grouped by status. A deadline that is only an estimate is shown as
one, and a deadline "anywhere on Earth" counts down to its real end.

## Add data

Tag a note `#deadline` and give it the property `date` (for example `2027-03-01`).
Optional properties:

- `event`: the lane it sits in (a conference, a project)
- `end`: makes it a range from `date` to `end`
- `announced`: `false` marks the date as an estimate
- `aoe`: `true` for a deadline anywhere on Earth
- `status`: shows the note as a card in a status column

To follow another tag, change `TAG` at the top of `app.js`.
