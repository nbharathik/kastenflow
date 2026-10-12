// The graph drawn on a canvas. All the behaviour (the camera, hit testing,
// clicks, drags, keys) is the controller's; this wires it to React: it makes
// the controller, keeps it told of the model and settings, and hands the view a
// few methods (fit, zoom, bring a node to the middle).

import "./graph.css";

import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from "react";

import { GraphController, type Handlers, type Settings } from "./controller";
import type { Model } from "./graph-model";

export interface GraphCanvasHandle {
  /** The layout moved the nodes: the canvas follows the picture. */
  frame(): void;
  fit(): void;
  zoomBy(factor: number): void;
  focusNode(index: number): void;
  /** Where node `index` is on the canvas, in pixels from its top left. */
  screenOf(index: number): { x: number; y: number } | null;
}

interface Props extends Settings {
  model: Model;
  /** The nodes' places, x, y pairs, kept by the layout. */
  places: RefObject<Float32Array | null>;
  handlers: Handlers;
  /** What the canvas is, for people who cannot see it. */
  label: string;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas({ model, places, handlers, label, colourBy, selected, nameAll, editable }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const control = useRef<GraphController | null>(null);
  // The controller is made once; it reads the latest handlers through this.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const forward: Handlers = {
      select: (i) => latest.current.select(i),
      open: (i, keys) => latest.current.open(i, keys),
      openHere: (i) => latest.current.openHere(i),
      context: (i, at) => latest.current.context(i, at),
      createAt: (x, y) => latest.current.createAt(x, y),
      linkTo: (from, x, y) => latest.current.linkTo(from, x, y),
    };
    const made = new GraphController(element, forward, () => places.current);
    control.current = made;
    return () => {
      made.destroy();
      control.current = null;
    };
  }, [places]);

  useEffect(() => {
    control.current?.update(model, { colourBy, selected, nameAll, editable });
  }, [model, colourBy, selected, nameAll, editable]);

  useImperativeHandle(
    ref,
    () => ({
      frame: () => control.current?.frame(),
      fit: () => control.current?.fit(),
      zoomBy: (factor) => control.current?.zoomBy(factor),
      focusNode: (index) => control.current?.focusNode(index),
      screenOf: (index) => control.current?.screenOf(index) ?? null,
    }),
    [],
  );

  return <canvas ref={canvas} className="kasten-graph-canvas" tabIndex={0} role="application" aria-roledescription="graph" aria-label={label} />;
});
