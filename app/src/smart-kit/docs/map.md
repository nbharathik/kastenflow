# map

A world map with pins, labels and highlighted regions, such as the host cities of a
conference. Needs `lib/dom.js`, `lib/keys.js`, `components/map.js`, then
`data/world-110m.js` (after the component), and `kit-visual.css`. Everything is drawn
from files the kit carries: nothing is fetched, so it works with no network.

Data: `{ pins: [{ label, lat, lon, note?, id? }], highlight: ["France", "Asia", ...] }`, or just the list of pins.

- `lat` and `lon` are degrees. A pin without a usable position is left out and one line says how many.
- A highlighted region matches a region's name, its code or its continent, ignoring case. The world data decides which names exist: with country data "Europe" lights every European country; with the coarse placeholder file it lights the continent.
- Options: `fit` (`"world"`, or `"content"` to zoom to the pins and highlighted regions), `labels` (`true`, `false`, or `"auto"`: shown up to 12 pins), `list: false` (hide the list of places beside the map), `world` (other map data), `onSelect(pin, index)`, `label`, `empty`.
- The map is an image with a name and a text description of every place; the list of places beside it is the keyboard way in. A pin with an `id` opens its note (or calls `onSelect`). Hovering or focusing a place highlights its pin.
- `kit.maps.project(lon, lat)` gives `[x, y]` on the 1000 wide canvas (Equal Earth projection) if a page wants to draw its own marks.

## Map data

`data/world-110m.json` is the source: `regions: [{ id, iso?, name, continent?, rings: [ [ [lon, lat], ... ] ] }]`,
one ring per polygon, longitude -180 to 180 (no ring crosses the antimeridian). The page loads the script
`data/world-110m.js`, which `data/build-world.mjs` builds from the JSON.

## Example

```js
kit.components.map(document.getElementById("app"), {
  label: "Host cities",
  data: {
    pins: [
      { label: "Lisbon", lat: 38.7, lon: -9.1, note: "2027" },
      { label: "Tokyo", lat: 35.7, lon: 139.7, note: "2028" },
    ],
    highlight: ["Europe"],
  },
});
```
