import type { Mask } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, useState } from "react";

import { colorOf, fontStack, placeholderOf } from "../../theme/index.ts";
import type { ViewProps } from "../context.ts";
import { isCover } from "../cover.ts";
import { cropFrame } from "../crop.ts";
import { clamp } from "../format.ts";
import { adjustFilter, maskClip } from "../image-look.ts";
import { shadowFilter, strokeWidthOf } from "../style.ts";

/** The corner radius of a rounded mask when the style names none. */
export const DEFAULT_MASK_RADIUS = 12;

/** How the mask cuts the picture: rounded corners of a size, or a full ellipse. */
export function maskRadius(mask: Mask | null | undefined, radius: number | null | undefined, w: number, h: number): string | undefined {
  switch (mask) {
    case "roundRect":
      return `${clamp(radius ?? DEFAULT_MASK_RADIUS, 0, Math.min(w, h) / 2)}px`;
    case "ellipse":
      return "50%";
    default:
      return undefined;
  }
}

/** An outline of the mask's shape, drawn over the picture. */
function frameOf(radius: string | undefined, width: number, color: string): CSSProperties {
  return { borderRadius: radius, border: `${width}px solid ${color}` };
}

/** The empty slot of a picture, which an editor shows so there is somewhere to put one. */
function EmptyImage({ cx, box, prompt }: Pick<ViewProps<"image">, "cx" | "box"> & { prompt: string }): JSX.Element {
  const muted = colorOf(cx.theme, "text2");
  const side = Math.min(box.w, box.h);
  const icon = clamp(side * 0.25, 16, 56);
  return (
    <div
      className="ks-image-empty"
      style={{ borderColor: colorOf(cx.theme, "text2", 0.55), background: colorOf(cx.theme, "text2", 0.06), color: muted, fontFamily: fontStack(cx.theme, "body") }}
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.75" />
        <path d="M3 17l5-5 4 4 3-3 6 6" />
      </svg>
      {side >= 60 && prompt !== "" && <span style={{ fontSize: clamp(side * 0.08, 10, 16) }}>{prompt}</span>}
    </div>
  );
}

/** A picture, cropped and masked as the element says. */
export function ImageView({ element, box, cx }: ViewProps<"image">): JSX.Element {
  const { theme } = cx;
  const [failed, setFailed] = useState<string | null>(null);
  const url = element.src === "" ? undefined : cx.imageUrl ? cx.imageUrl(element.src) : element.src;

  if (element.src.trim() === "") {
    const prompt = placeholderOf(theme, cx.layout, element)?.prompt ?? element.alt ?? "";
    return <EmptyImage cx={cx} box={box} prompt={prompt} />;
  }

  // A mask of any preset shape takes the place of the three plain masks.
  const clip = maskClip(element.style?.maskShape, box.w, box.h);
  const radius = clip ? undefined : maskRadius(element.mask, element.style?.radius, box.w, box.h);
  const frame = cropFrame(element.crop);
  const stroke = element.style?.stroke;
  const outline = strokeWidthOf(stroke);
  const filter = shadowFilter(theme, element.style?.shadow);
  const touched = adjustFilter(element.style?.adjust);
  const broken = url === undefined || failed === url;
  const picture = (
    <div className="ks-image" style={{ borderRadius: radius, filter: clip ? undefined : filter, clipPath: clip }}>
      {broken ? (
        <div className="ks-image-failed" style={{ background: colorOf(theme, "text2", 0.25) }} role="img" aria-label={element.alt ?? undefined} />
      ) : (
        <img
          className="ks-image-pic"
          src={url}
          alt={element.alt ?? ""}
          draggable={false}
          decoding="async"
          style={{ ...(frame ?? { left: 0, top: 0, width: "100%", height: "100%", ...(isCover(element) ? { objectFit: "cover" as const } : {}) }), filter: touched }}
          onError={() => setFailed(url)}
        />
      )}
      {stroke && outline > 0 && !clip && <div className="ks-image-frame" style={frameOf(radius, outline, colorOf(theme, stroke.color, stroke.alpha))} />}
    </div>
  );
  // A clip path would cut the shadow away, so a shaped picture's shadow is cast by a box around it.
  return clip ? (
    <div className="ks-image" style={{ filter }}>
      {picture}
    </div>
  ) : (
    picture
  );
}
