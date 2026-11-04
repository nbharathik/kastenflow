import { type JSX, useEffect, useRef } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { type Plan, type Position, spotAt } from "../plan.ts";
import { AudioShow } from "./audio-show.ts";

export interface AudioLayerProps {
  plan: Plan;
  position: Position;
  imageUrl: ImageUrl;
}

/** The slide shown is the `h`th column of the plan; a sound that plays "across" slides counts the columns. */
const heads = (plan: Plan) => plan.columns.map((column) => column.slides[0]).filter((slide): slide is NonNullable<typeof slide> => slide !== undefined);

/**
 * The sound of the show, drawn as nothing. It plays the sounds of the slide that comes up (and carries those of the slides before it that
 * were told to go on), and takes a click on the chip of a sound that is waiting for one, so the click starts it and does not move the show on.
 */
export function AudioLayer({ plan, position, imageUrl }: AudioLayerProps): JSX.Element {
  const show = useRef<AudioShow | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const url = useRef(imageUrl);
  url.current = imageUrl;
  show.current ??= new AudioShow();
  const spot = spotAt(plan, position);

  // The show is on a slide: its sounds begin and those that have gone past their slides end.
  useEffect(() => {
    const slides = heads(plan);
    if (!spot || slides.length === 0) return;
    const index = Math.min(Math.max(position.h, 0), slides.length - 1);
    show.current?.enter(slides, index, (path) => url.current(path));
  }, [plan, position.h, spot?.slide.id]);

  // A click on a chip is for the sound, not for the show.
  useEffect(() => {
    const stage = anchor.current?.closest(".ks-show");
    if (!stage) return;
    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      for (let node = target.closest<HTMLElement>("[data-el]"); node; node = node.parentElement?.closest<HTMLElement>("[data-el]") ?? null) {
        const id = node.dataset.el;
        if (id && show.current?.hears(id) && show.current.toggle(id)) {
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }
    };
    stage.addEventListener("click", onClick, true);
    return () => stage.removeEventListener("click", onClick, true);
  }, []);

  // The show ends and the sounds with it.
  useEffect(() => () => show.current?.dispose(), []);

  return <span ref={anchor} className="ks-show-audio" hidden />;
}
