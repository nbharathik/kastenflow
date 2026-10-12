# @kasten-slides/canvas

The canvas engine behind KastenFlow Slides: selection, move, resize and rotate,
snapping guides, grouping, undo and zoom. It has no dependencies and knows
nothing about slides or KastenFlow; the slide editor and the whiteboard both
build on it.

It is plain TypeScript with no DOM and no framework. An editor turns pointer
events into calls to these functions and draws what they return.

Licensed under the Apache License, Version 2.0.

## Conventions

- Positions and sizes are in slide units (a slide is 960 x 540). `y` points
  down. To work in screen pixels, go through a `View` (`toSlide`, `toScreen`).
- Angles are degrees, clockwise. An item's `rotation` turns it about its
  centre, and its `x`, `y`, `w` and `h` describe the box before it is turned.
- A list of items runs back to front: the last item is on top.
- Nothing changes what it is given. Functions return new values, and a session
  builds new maps and objects on every `update`.
- What a session hands out is rounded to a billionth of a unit, so an edge that
  snapped to a line at 250.9 is at 250.9, not 250.90000000000003. The plain
  functions return the numbers as they come.
- Distances that come from the screen (a click's travel, a snap reach, a
  handle's offset) are given in slide units, so divide pixels by the zoom.

## A drag, end to end

```ts
const session = MoveSession.start({
  items: selected, // the items being dragged
  all: items, // everything on the slide, for snapping
  frame: { width: 960, height: 540, margin: 48 },
  grabbed: toSlide(view, { x: down.clientX, y: down.clientY }),
  threshold: 3 / view.zoom, // a press that travels less is a click
});

// on every pointer move
const { moves, guides } = session.update(toSlide(view, point), { shift: e.shiftKey, alt: e.altKey });
// draw the items at `moves`, and the `guides`

// on release
const done = session.end();
if (done.moved) commit(done.moves); // one change, at the very end
```

The other sessions work the same way: `start` with a snapshot, `update` with
each pointer position and the modifier keys, `end` for the result.

## Public API

Everything is exported from the package root.

### Items and selection

| Name | Signature | What it does |
| --- | --- | --- |
| `Item` | `{ id: string; x: number; y: number; w: number; h: number; rotation?: number; locked?: boolean }` | Something on the canvas. |
| `Box` | `{ x; y; w; h; rotation?: number }` | An item without the id: what the transforms work on. |
| `boundsOf` | `(box: Box) => Rect` | The upright box that holds `box` once it is turned. |
| `selectionBounds` | `(items: readonly Item[], ids: Iterable<string>) => Rect \| null` | The upright box holding the turned boxes of the chosen items; `null` when none is chosen. |
| `hitTest` | `(items, point: Point, opts?: { includeLocked?: boolean; tolerance?: number }) => string \| null` | The id of the topmost item under `point`, honouring rotation. Locked items are skipped unless `includeLocked`. `tolerance` grows every item's box; an item thinner than 6 units, such as a line, always gets a 6 unit band. |
| `marqueeHits` | `(items, rect: Rect, mode?: "touch" \| "contain", opts?: { includeLocked?: boolean }) => string[]` | The ids a drag rectangle picks, back to front. `"contain"` (the default) takes items wholly inside; `"touch"` takes any overlap. Turned items count by their turned box. Locked items are left out. |
| `applySelection` | `(current: readonly string[], picked: readonly string[], how: "replace" \| "add" \| "toggle") => string[]` | The selection after a click or drag combines with the current one. |
| `cycle` | `(order: readonly string[], current: string \| null, backwards?: boolean) => string \| null` | The id Tab (or Shift+Tab) moves to, wrapping round. From nothing it starts at the first, or the last going backwards. |

### Transforms

| Name | Signature | What it does |
| --- | --- | --- |
| `Handle` | `"nw" \| "n" \| "ne" \| "e" \| "se" \| "s" \| "sw" \| "w"` | The eight resize handles. `HANDLES` lists them clockwise from the top left. |
| `handlePoints` | `(item: Box, zoom?: number) => Record<Handle \| "rotate", Point>` | The centre of each handle by name, turned with the box, in slide units, and `rotate`, the rotate handle, which floats `24 / zoom` units above the top middle (in the box's own frame, so it turns with the box). |
| `resizeBox` | `(start: Box, handle: Handle, pointer: { dx: number; dy: number }, opts?: { keepRatio?: boolean; fromCentre?: boolean; minSize?: number }) => { box: Box; flipH: boolean; flipV: boolean }` | The box after dragging `handle`. `pointer` is the pointer's total movement in slide units since the drag began; it is taken along the box's own axes, so a turned box resizes along its own width. The opposite edge (the centre with `fromCentre`) stays fixed in slide space. `keepRatio` scales both sides by one factor (a corner follows the larger stretch; an edge handle scales the other side about its centre line). `minSize` defaults to 1. Sizes are never negative: dragging past the opposite edge mirrors, and `flipH` / `flipV` say the box is now mirrored relative to its start. |
| `rotationFor` | `(pivot: Point, pointer: Point, grabbedAt: Point, startRotation: number, opts?: { step?: number }) => number` | The rotation in [0, 360) that keeps the box under the pointer's angle about `pivot` (the box's centre): it was `startRotation` when the pointer went down at `grabbedAt`. With `step` the whole rotation snaps to a multiple of it. |
| `scaleWithin` | `<T extends Box>(items: readonly T[], from: Rect, to: Rect) => T[]` | Maps every box from `from` to `to`, as when several items are resized as one. Centres are mapped and sides stretched along each item's own axes, so a quarter-turned item still fills its share of the box. Rotation and all other fields are kept. |
| `mirrorWithin` | `<T extends Box>(items: readonly T[], box: Rect, flip: { h?: boolean; v?: boolean }) => T[]` | Reflects boxes across the middle of `box`. A reflection turns rotation the other way. |
| `mirrorHandle` | `(handle: Handle, flip: { h?: boolean; v?: boolean }) => Handle` | The handle really being dragged once a resize has passed the opposite edge. |
| `handleDirection` | `(handle: Handle) => { x: -1 \| 0 \| 1; y: -1 \| 0 \| 1 }` | Which edges a handle drags. |
| `nudge` | `<T extends Box>(items: readonly T[], dx: number, dy: number) => T[]` | The boxes moved by (`dx`, `dy`). |
| `ROTATE_OFFSET`, `ROTATE_STEP` | `24`, `15` | The rotate handle's distance in pixels, and the angle Shift snaps to. |

### Snapping

| Name | Signature | What it does |
| --- | --- | --- |
| `Frame` | `{ width: number; height: number; margin?: number }` | The slide. A `margin` adds guides that far in from each side. |
| `Guide` | `{ axis: "x" \| "y"; at: number; from: number; to: number; kind: "edge" \| "centre" \| "margin" \| "spacing" }` | A line to draw: an `x` guide is vertical at x = `at`, running from y = `from` to `to`; a `y` guide is horizontal. A `spacing` guide marks a gap: a `y` guide runs across the gap between boxes side by side, an `x` guide down the gap between boxes one above the other. |
| `SnapOptions` | `{ threshold?: number; enabled?: boolean; axis?: "x" \| "y" }` | What `snapMove` and `snapResize` take as options. |
| `snapMove` | `(moving: Rect, targets: readonly Rect[], frame: Frame, opts?: { threshold?: number; enabled?: boolean; axis?: "x" \| "y" }) => { dx: number; dy: number; guides: Guide[] }` | Given the moving box, already at its dragged position, the smallest move on each axis (within `threshold`, default 6) that lines its left, centre and right (top, middle, bottom) up with those of a target, of the slide or of its margins, or that makes its gap to a neighbour equal another gap in the row or column. Every line it lands on is reported, drawn for the box after `dx` and `dy`. `enabled: false` returns no move and no guides. `axis` limits it to one axis. |
| `snapResize` | `(box: Rect, handle: Handle, targets, frame, opts?: SnapOptions & { keepRatio?: boolean }) => { dx; dy; guides }` | The same for a resize, snapping only the edges `handle` drags; `dx` and `dy` are how far to move those edges. `box` is upright with positive size; after a flip pass the handle that `mirrorHandle` gives. With `keepRatio` a corner lands on one line and the other edge follows. |

Equal spacing looks at the boxes level with the moving one (overlapping it
across the axis): it copies the gap between the two nearest on one side, on
either side, and it centres the box between the nearest on each side.

### Sessions

A session takes a snapshot in `start`, gives a preview from every `update`, and
gives the result from `end`. `end` takes an optional last pointer position.
`Mods` is `{ shift?: boolean; alt?: boolean; noSnap?: boolean }`. Pointer
positions are in slide units, as are `grabbed`, `origin` and the thresholds.

| Name | Start | `update(pointer, mods?)` | `end()` |
| --- | --- | --- | --- |
| `MoveSession` | `{ items, all, frame, grabbed, threshold?, snapThreshold? }` | `{ moves: Map<id, { x, y }>; guides }`. Shift locks to the dominant axis, and snaps along it only. Alt (or `noSnap`) turns snapping off. Snapping is of the selection's bounding box. | `{ moves, moved }`; `moves` is empty when the press never became a drag. |
| `ResizeSession` | `{ items, handle, all, frame, grabbed?, snapThreshold? }` | `{ boxes: Map<id, { x, y, w, h, rotation?, flipH?, flipV? }>; guides }`. One item uses `resizeBox`; several use the selection's bounds and `scaleWithin`. Shift keeps the ratio, Alt resizes from the centre, `noSnap` turns snapping off. A single item that is turned takes no snap; a group always does, as its bounds are upright. | `{ boxes, changed }` |
| `RotateSession` | `{ items, grabbed }` | `{ boxes: Map<id, { x, y, w, h, rotation }>; angle }`. Several items turn about the centre of their bounds, each centre orbiting and each rotation increasing by the same amount. Shift turns in 15 degree steps. | `{ boxes, angle, changed }` |
| `MarqueeSession` | `{ all, origin, base, additive, mode? }` | `{ rect: Rect; ids: string[] }`; `ids` merges with `base` when `additive`. | `{ rect, ids }` |

- `MoveSession.moved` is `false` until the pointer has travelled `threshold`
  (default 3, in slide units) from `grabbed`; before that `update` returns
  every item where it began. Once it has, it stays `true`.
- `flipH` and `flipV` appear, as `true`, only on boxes to mirror: the drag went
  past the opposite edge. They are toggles to apply to an item's own flip.
- `ResizeSession` takes the handle's own position as the grab when `grabbed`
  is left out.
- `changed` is `false` when nothing differs from how the drag began, so there
  is nothing to commit.

### View

| Name | Signature | What it does |
| --- | --- | --- |
| `View` | `{ zoom: number; panX: number; panY: number }` | Maps slide units to screen pixels: `screen = slide * zoom + pan`. |
| `fitView` | `(container: Size, content: Size, padding?: number) => View` | The view that shows all of `content` in `container`, centred, with `padding` (default 24) pixels to spare. Its zoom stays within `ZOOM_LIMITS`. |
| `zoomAt` | `(view: View, screenPoint: Point, factor: number, limits?: readonly [number, number]) => View` | Zooms about a screen point, which keeps the same slide point under it. `limits` default to `ZOOM_LIMITS`, `[0.1, 8]`. |
| `panBy` | `(view: View, dx: number, dy: number) => View` | Slides the view by screen pixels. |
| `toSlide` | `(view: View, screenPoint: Point) => Point` | The slide point under a screen point. |
| `toScreen` | `(view: View, slidePoint: Point) => Point` | Where a slide point is drawn. |
| `wheelZoomFactor` | `(deltaY: number, ctrl: boolean) => number` | The factor for `zoomAt` from one wheel event: above 1 for a negative `deltaY`. `ctrl` is for a pinch or Ctrl+wheel, whose deltas are small. One event changes the zoom by at most 22 per cent. |

### History

| Name | Signature | What it does |
| --- | --- | --- |
| `History<T>` | `new History<T>(cap = 100)` | A small undo history of states. Push each state as it is reached, starting with the first. |
| `push` | `(state: T) => void` | Records a new state after the current one and forgets anything that could have been redone. |
| `undo`, `redo` | `() => T \| undefined` | Steps back or forward and returns the state reached; `undefined` when there is nowhere to go. |
| `canUndo`, `canRedo` | `boolean` (getters) | Whether there is a state to go back or forward to. |
| `current` | `T \| undefined` (getter) | The state now. |
| `clear` | `() => void` | Forgets every state, the current one too. |
| `cap` | `number` (read only) | The most undo steps kept; older states are dropped. |

### Geometry

`Point`, `Size`, `Rect`, `right`, `bottom`, `centre`, `contains`, `encloses`,
`intersects`, `union`, `between`, `rotatePoint`, `corners`, `turnedBounds` and
`snapTo`, plus `clamp`, `normaliseAngle` (into [0, 360)) and `directionOf` (the
unit vector `degrees` clockwise from the x axis, exact at quarter turns).
