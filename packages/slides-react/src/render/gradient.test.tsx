import type { Gradient, Style } from "@kasten-slides/wasm";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ShapeGraphic } from "./elements/ShapeGraphic.tsx";
import { gradientParts, paintOf, paintsBox } from "./style.ts";
import { plainDeck } from "./testing/decks.ts";

afterEach(cleanup);

const theme = plainDeck([]).deck.theme;
const gradient = (extra: Partial<Gradient> = {}): Gradient => ({
  kind: "linear",
  angle: 0,
  stops: [
    { pos: 1, color: "#0000ff" },
    { pos: 0, color: "#ff0000" },
  ],
  ...extra,
});

describe("a gradient fill", () => {
  it("orders the stops and runs the line across the shape at the angle, through its middle", () => {
    const parts = gradientParts(theme, gradient());
    expect(parts.stops.map((s) => [s.offset, s.color])).toEqual([
      ["0", "#ff0000"],
      ["1", "#0000ff"],
    ]);
    expect(parts.line).toEqual({ x1: "0", y1: "0.5", x2: "1", y2: "0.5" });
    const down = gradientParts(theme, gradient({ angle: 90 })).line;
    expect([down.x1, down.y1, down.x2, down.y2]).toEqual(["0.5", "0", "0.5", "1"]);
  });

  it("is painted in place of the solid fill, which stays as the nearest colour", () => {
    const style: Style = { fill: { color: "#808080" }, gradient: gradient() };
    const paint = paintOf(theme, style);
    expect(paint.gradient).toBeDefined();
    expect(paint.fill).toBe("#808080");
    expect(paintsBox({ gradient: gradient() })).toBe(true);
  });

  it("needs two colours, else it is the fill", () => {
    const one = gradient({ stops: [{ pos: 0, color: "#ff0000" }] });
    expect(paintOf(theme, { fill: { color: "#808080" }, gradient: one }).gradient).toBeUndefined();
  });

  it("draws a shape with a gradient the shape paints with", () => {
    const { container } = render(<ShapeGraphic theme={theme} style={{ gradient: gradient({ kind: "radial" }) }} name="rect" w={100} h={50} />);
    expect(container.querySelector("radialGradient")).not.toBeNull();
    expect(container.querySelectorAll("stop")).toHaveLength(2);
    const fill = container.querySelector("path")?.getAttribute("fill") ?? "";
    expect(fill).toMatch(/^url\(#ks-grad-/);
    const { container: plain } = render(<ShapeGraphic theme={theme} style={{ gradient: gradient() }} name="rect" w={100} h={50} />);
    expect(plain.querySelector("linearGradient")).not.toBeNull();
  });
});
