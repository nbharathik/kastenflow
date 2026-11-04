// The window's drawing of a deck for an agent, with the renderer the editor's own picture
// export uses: each slide as static markup, turned into pixels by the browser. The deck
// arrives as text; its pictures are read from the vault's assets, as the editor reads them.
// Loaded only when an agent first asks, since it carries the slide renderer.

import { DeckEngine, loadSlides, picturePaths } from "@kasten-slides/wasm";
import type { Deck, Measures } from "@kasten-slides/wasm";
import { loadMeasurer, measureProbes, slidePictures } from "@kasten-slides/react/render-host";
import type { PngScale } from "@kasten-slides/react/render-host";

import { useWorkspace } from "../workspace/store";
import type { Shots, SlidesJob } from "./draw-slides";
import { composeDiff, composeGrid, diffLayout, gridLayout } from "./slide-compose";

/** How many times the words are measured again because a font arrived in the meantime. */
const MOST_ROUNDS = 4;

/** Opens the deck's text; why not, in words. */
async function open(text: string): Promise<DeckEngine> {
  await loadSlides();
  try {
    return DeckEngine.open(text);
  } catch (err) {
    throw new Error(`The window could not open the deck: ${err instanceof Error ? err.message : "it is not a deck"}`, { cause: err });
  }
}

/** The vault pictures a deck names, by the path the deck uses; one that cannot be read is left out. */
async function imagesOf(deck: Deck): Promise<Map<string, Uint8Array>> {
  const client = useWorkspace.getState().client;
  const images = new Map<string, Uint8Array>();
  for (const path of picturePaths(deck)) {
    const bytes = await client?.readAsset(path).catch(() => undefined);
    if (bytes) images.set(path, bytes);
  }
  return images;
}

/** One slide of the deck as PNG bytes, at the click `step` (none: as it ends), at `scale` within `maxSide` pixels. */
async function slideOf(deck: Deck, index: number, step: number | null, scale: number, maxSide: number): Promise<Uint8Array> {
  const slide = deck.slides[index];
  if (!slide) throw new Error(`There is no slide ${index + 1}: the deck has ${deck.slides.length}.`);
  const steps = slide.steps ?? 0;
  if (step !== null && (!Number.isInteger(step) || step < 0 || step > steps)) {
    throw new Error(steps === 0 ? `Slide ${index + 1} has no steps, so there is no step ${step}. Leave the step out to see the slide.` : `Slide ${index + 1} has steps 0 to ${steps}; there is no step ${step}.`);
  }
  const fit = Math.min(scale, maxSide / Math.max(deck.size.w, deck.size.h));
  const images = await imagesOf(deck);
  const each = step !== null && steps > 0;
  const { pictures } = await slidePictures(deck, { scope: "current", scale: fit as PngScale, steps: each ? "each" : "final" }, { images, current: slide.id });
  const picture = each ? pictures.find((p) => p.name.endsWith(`-step-${step}.png`)) : pictures[0];
  if (!picture) throw new Error(`The window could not draw slide ${index + 1}`);
  return picture.bytes;
}

/** Opens a deck, does `work` with it, and lets it go. */
async function withDeck<T>(text: string, work: (deck: Deck) => Promise<T>): Promise<T> {
  const engine = await open(text);
  try {
    return await work(engine.deck);
  } finally {
    engine.dispose();
  }
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function measuresOf(engine: DeckEngine): Measures {
  const slides: Measures["slides"] = {};
  for (const slide of engine.deck.slides) {
    const sizes = measureProbes(engine.deck.theme, engine.lintProbes(slide.id));
    if (Object.keys(sizes).length > 0) slides[slide.id] = sizes;
  }
  return { slides };
}

export const shots: Shots = {
  slide: (text, index, step, scale, maxSide) => withDeck(text, (deck) => slideOf(deck, index, step, scale, maxSide)),

  grid: (text, maxSide) =>
    withDeck(text, async (deck) => {
      const layout = gridLayout(deck.slides.length, deck.size.w, deck.size.h, maxSide);
      const thumbs: Uint8Array[] = [];
      for (let index = 0; index < deck.slides.length; index++) thumbs.push(await slideOf(deck, index, null, layout.thumb.w / deck.size.w, maxSide));
      return composeGrid(thumbs, layout);
    }),

  async diff(job: SlidesJob & { before: string }, scale: number) {
    const size = (await withDeck(job.after, (deck) => Promise.resolve(deck.size)));
    const layout = diffLayout(size.w, size.h, scale, job.maxSide);
    const after = await withDeck(job.after, (deck) => slideOf(deck, job.slide ?? 0, job.step ?? null, layout.scale, job.maxSide));
    const before = await withDeck(job.before, (deck) => slideOf(deck, job.beforeSlide ?? 0, job.step ?? null, layout.scale, job.maxSide));
    return composeDiff({ before, after }, layout, size.w, { before: job.beforeMarks ?? [], after: job.afterMarks ?? [] });
  },

  async measure(text) {
    const engine = await open(text);
    try {
      await loadMeasurer();
      // The first pass makes the browser fetch the fonts the words are set in; the next ones see them.
      let measures = measuresOf(engine);
      for (let round = 0; round < MOST_ROUNDS; round++) {
        await document.fonts?.ready;
        await frame();
        const again = measuresOf(engine);
        const settled = JSON.stringify(again) === JSON.stringify(measures);
        measures = again;
        if (settled) break;
      }
      return measures;
    } finally {
      engine.dispose();
    }
  },
};
