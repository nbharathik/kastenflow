// The banner's only motion: when the live page first comes into view, a short
// tour ticks a to-do and types a line with a page link, so the file is seen
// following before anyone touches anything. It plays once, takes about six
// seconds and stops at the visitor's first touch, leaving nothing half
// typed. A visitor who prefers reduced motion gets no tour at all.

import { still, wait, whenSeen } from "./dom.js";

const DRAFT = "Book the ferry, see [[Fer";

export function setupHeroTour(root, demo) {
  let touched = false;
  for (const type of ["pointerdown", "keydown"]) root.addEventListener(type, () => (touched = true), { once: true });

  whenSeen(root, async () => {
    if (still) return;
    demo.quietly(true);
    await wait(1200);
    if (!touched) demo.tick(1);
    await wait(1300);
    let typed = "";
    for (const letter of DRAFT) {
      if (touched) break;
      typed += letter;
      demo.type(typed);
      await wait(55);
    }
    await wait(900);
    if (!touched) {
      demo.pick(0);
      typed = demo.draft();
    }
    await wait(700);
    if (!touched) demo.commit();
    // Taking over mid-sentence: clear what the tour typed, unless the visitor has added to it.
    if (touched && demo.draft() === typed) demo.type("");
    demo.quietly(false);
  });
}
