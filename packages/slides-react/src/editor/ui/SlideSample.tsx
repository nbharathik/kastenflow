import { type JSX, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import { type Pixels, hexAt, nudged, pointOn, sampleSlide } from "./color-sample.ts";

interface SlideSampleProps {
  /** A colour was chosen: `#rrggbb`. */
  onPick(hex: string): void;
  /** The person gave up (Escape). */
  onClose(): void;
}

/**
 * The eyedropper for browsers that have none: a picture of the slide to point at. A click (or Enter, after the arrow keys have moved
 * the cross) takes the colour under the pointer; Escape puts the dropper down.
 */
export function SlideSample({ onPick, onClose }: SlideSampleProps): JSX.Element {
  const [pixels, setPixels] = useState<Pixels | null | "failed">(null);
  const [at, setAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    void sampleSlide().then((found) => live && setPixels(found ?? "failed"));
    return () => {
      live = false;
    };
  }, []);

  // The picture is drawn once it is there; the cross is drawn over it as the pointer moves.
  useEffect(() => {
    const node = canvas.current;
    if (!node || pixels === null || pixels === "failed") return;
    const context = node.getContext("2d");
    if (!context) return;
    node.width = pixels.width;
    node.height = pixels.height;
    context.putImageData(new ImageData(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height), 0, 0);
  }, [pixels]);

  if (pixels === null) return <p className="ks-sp-hint">Looking at the slide…</p>;
  if (pixels === "failed") {
    return (
      <p className="ks-sp-hint is-error" role="alert">
        This browser cannot draw the slide to pick a colour from it. Type the colour instead.
      </p>
    );
  }

  const under = hexAt(pixels, at.x, at.y);
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const found = pointOn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, pixels);
    if (found) setAt(found);
  };
  const key = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (under) onPick(under);
      return;
    }
    const next = nudged(at, event.key, event.shiftKey, pixels);
    if (next) {
      event.preventDefault();
      setAt(next);
    }
  };

  return (
    <div className="ks-slide-sample">
      <canvas
        ref={canvas}
        className="ks-slide-sample-view"
        tabIndex={0}
        role="img"
        aria-label={`Picture of the slide. Arrow keys move the pointer, Enter picks. Under it now: ${under ?? "nothing"}`}
        data-autofocus=""
        onPointerMove={move}
        onPointerDown={move}
        onClick={(event) => {
          const found = pointOn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, pixels);
          const hex = found ? hexAt(pixels, found.x, found.y) : null;
          if (hex) onPick(hex);
        }}
        onKeyDown={key}
      />
      <div className="ks-slide-sample-now">
        <span className="ks-swatch is-preview" style={{ background: under ?? "transparent" }} aria-hidden="true" />
        <span className="ks-sp-value">{under ?? "Nothing here"}</span>
      </div>
    </div>
  );
}
