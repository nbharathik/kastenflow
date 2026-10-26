# gallery

A grid of pictures with captions. Needs `lib/dom.js`, `lib/keys.js`, `components/gallery.js`.

Data: `[{ src, title?, caption?, alt?, id? }]`. `src` is a picture inside the page's folder (or a data address).

- An item with an `id` is a button that opens that note (`kasten.open(id)`); pass `onSelect(item, index)` to do something else. Arrow keys, Home and End move between the buttons (one tab stop).
- A picture with no `src` shows a plain placeholder. `alt` defaults to the title.
- Options: `columns` (fixed column count), `label`, `empty`, `onSelect`.

## Example

```js
kit.components.gallery(document.getElementById("app"), {
  label: "Sketches",
  columns: 3,
  onSelect: (item) => kit.keys.announce("Opened " + item.title),
  data: [
    { src: "assets/a.png", title: "First", caption: "Rough layout" },
    { title: "Second", caption: "No picture yet" },
  ],
});
```
