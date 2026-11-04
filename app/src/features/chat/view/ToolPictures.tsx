// The pictures a tool drew (a slide) as thumbnails under its step in the chat, so the person sees
// what the assistant saw. A thumbnail opens larger on a click and closes on Escape or another click.

import { useState } from "react";

import "./tool-pictures.css";

/** The thumbnails of `pictures` (`data:` URLs); nothing when there are none. */
export function ToolPictures({ pictures }: { pictures?: readonly string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!pictures || pictures.length === 0) return null;
  const shown = open === null ? undefined : pictures[open];
  return (
    <div className="tool-pictures">
      <ul className="tool-pictures-list" aria-label="Pictures from this step">
        {pictures.map((src, index) => (
          <li key={src.slice(-64) + index}>
            <button type="button" className="tool-picture" aria-label={`Show picture ${index + 1} larger`} aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
              <img src={src} alt={`Picture ${index + 1} drawn by this step`} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <button
          type="button"
          className="tool-picture-large"
          aria-label="Close the larger picture"
          onClick={() => setOpen(null)}
          onKeyDown={(event) => event.key === "Escape" && setOpen(null)}
        >
          <img src={shown} alt={`Picture ${(open ?? 0) + 1} drawn by this step, larger`} />
        </button>
      )}
    </div>
  );
}
