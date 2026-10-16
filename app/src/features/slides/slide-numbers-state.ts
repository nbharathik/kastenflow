// Whether the dialog that turns slide numbers off in every deck is open. Tiny on purpose: the palette and the shell read it at start-up, and the
// dialog itself (and the slide engine it uses) is loaded when it is first shown.

import { create } from "zustand";

interface SlideNumbersState {
  open: boolean;
  show(): void;
  hide(): void;
}

export const useSlideNumbers = create<SlideNumbersState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
