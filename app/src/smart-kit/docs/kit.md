# The smart kit (version 1)

Plain files a smart page loads from `smart://kit/1/`. No build step.

```html
<link rel="stylesheet" href="smart://kit/1/kit.css">
<script src="smart://kit/1/kit.js"></script>
<script src="smart://kit/1/lib/dom.js"></script>
<script src="smart://kit/1/lib/dates.js"></script>
<script src="smart://kit/1/lib/format.js"></script>
<script src="smart://kit/1/lib/keys.js"></script>
<!-- then only the components you use: -->
<script src="smart://kit/1/components/legend.js"></script>
<script src="smart://kit/1/components/charts.js"></script>
<script src="smart://kit/1/components/countdown.js"></script>
```

Load order: `kit.js`, `lib/dom.js`, then the other `lib/` files, then components
(`legend.js` before `charts.js`; `charts.js` before `stat.js` if tiles show trends).

## `kasten`: talking to the app

`window.kasten` exists in a smart page. Every call returns a promise.

| Call | Gives |
| --- | --- |
| `kasten.query({ tag, filter?, sort?, limit? })` or `kasten.query("tag")` | notes |
| `kasten.list({ project?, tag?, type? })` | notes |
| `kasten.read(id)` | one note with its text |
| `kasten.search(q, limit?)` | hits (`kasten.search({ q, limit })` also works) |
| `kasten.journal("2027-03-01")` (or a `Date`) | the day's journal page |
| `kasten.project()` | the page's project |
| `kasten.tasks({ project?, tag?, done? })` | tasks |
| `kasten.board(path)` | a board's cards |
| `kasten.watch(query, cb, onError?)` | calls `cb` with the notes now and after each change; returns a function that stops it |
| `kasten.open(idOrPath)` | opens a note or page in the app |
| `kasten.theme()` | `"light"` or `"dark"` |
| `kasten.resize(px)` | asks for a taller or shorter block |
| `kasten.log(...args)` | writes to the app's page log |
| `kasten.update({ id, props })`, `kasten.addTags({ id, tags })`, `kasten.createNote({ title, tags?, props?, body?, project? })`, `kasten.append({ id, md })`, `kasten.toggleTodo({ id, index })` (or `kasten.toggle(id, index)`) | changes a note (runs under the project's agent mode: it is done, or kept for review and the answer says `pending_review`) |
| `kasten.ready()` | resolves `{ pageId, theme, view }` when the app has said hello |
| `kasten.onTheme(fn)` | `fn("light" \| "dark")` on every change; returns a function that stops it |

A failed call rejects with a `kit.KastenError`: `error.code` is `rate_limited`,
`too_large`, `refused`, `bad_request`, `not_found`, or (from the kit) `timeout`,
`closed`, `bad_response`. `error.retryable` is true for `rate_limited` and
`timeout`. Calls time out after 10 seconds. The app allows 50 calls a second, so
keep a query live with `watch` instead of asking again and again.

Errors the page throws (`error`, `unhandledrejection`, `console.error`) are sent
to the app on their own (at most 100 per load) and shown in the page's error log.

## Helpers

- `kit.h(tag, props, ...children)`: describe elements (`"div.card#id"`), `kit.render(container, view)` draws them touching only what changed, `kit.mount(container, viewFn, state)` re-draws on `api.set(patch)`.
- `kit.dates`: `daysUntil`, `daysUntilAoE`, `aoeInstant`, `aoeRemaining`, `describeDays`, `formatDate`, `dateInfo`, `addDays`, `isoDate`, `parseDate`, `compareDates`, `daysInMonth`.
- `kit.format`: `number`, `compact`, `percent`, `signed`, `plural`, `truncate`, `seriesColor`.
- `kit.keys`: `roving`, `onKeys`, `trapFocus`, `announce`. `kit.reducedMotion()`.
- `kit.components`: every component by name; `kit.defineComponent(name, def)` adds one.

## Components

Every component is `kit.components.<name>(target, options)` and returns
`{ el, update(data), setOptions(patch), redraw(), destroy() }`. Give it `data`,
or `watch` (a query; the notes arrive as the data, through `map` if you pass
one). `label` is its accessible name, `empty` the text for no data. Pages:
`countdown`, `gallery`, `table`, `stat`, `legend`, `bar`, `line`, `donut`, `sparkline`,
`timeline`, `kanban`, `calendar`, `map`. The last four also need
`<link rel="stylesheet" href="smart://kit/1/kit-visual.css">` after `kit.css`; the
map needs `components/map.js` and then `data/world-110m.js`.

## Example

```js
const app = document.getElementById("app");
kit.render(app, kit.h("p", {}, "Hello from the kit, version " + kit.version));
```
