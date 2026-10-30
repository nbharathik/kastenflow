# kanban

Cards in columns by status. Needs `lib/dom.js`, `lib/keys.js`, `components/kanban.js` and `kit-visual.css`.

Data: `[{ title, status, note?, tags?, id? }]`

- Columns follow `columns` (names, or `{ key, label }`); without it they are the statuses in the order they first appear. Statuses match without regard to case. Cards with another status go under "Other" (`otherLabel`).
- Each column is named with its count, for example "Doing, 2 cards". An empty column says "Nothing here." (`emptyColumn`).
- A card with an `id` opens its note (or calls `onSelect(item, index)`).
- Give `onMove(item, status)` and each card gets a "Move X to" menu; the kit does not change the note, the page decides (for example `kasten.update({ id: item.id, props: { status } })`).
- Options: `label`, `empty`.

## Example

```js
kit.components.kanban(document.getElementById("app"), {
  label: "Reading list",
  columns: ["To read", "Reading", "Done"],
  data: [
    { title: "Attention is all you need", status: "Done", tags: ["ml"] },
    { title: "Scaling laws", status: "Reading", note: "Chapter 3" },
    { title: "Diffusion models", status: "To read" },
  ],
});
```
