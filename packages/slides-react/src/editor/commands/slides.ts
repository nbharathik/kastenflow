import { requestFieldFocus, sectionField } from "../field-focus.ts";
import { sectionOf } from "../filmstrip/model.ts";
import { addSlide } from "../new-slide.ts";
import { anchorOf } from "../session/slides.ts";
import type { EditorState } from "../session/types.ts";
import type { Command } from "./types.ts";

const many = (s: { slideSelection: readonly string[] }) => s.slideSelection.length > 0;

/** The section the slide the section commands go by is in, if it is in one. */
const sectionHere = (s: EditorState) => sectionOf(s.deck, anchorOf(s));

/** Slides: adding, removing, ordering and the flags. */
export const slideCommands: Command[] = [
  {
    id: "slide.new",
    label: "New slide",
    icon: "plus",
    keys: ["Mod+M"],
    scope: "global",
    run: ({ session, ui }) => void addSlide(session, ui),
  },
  {
    id: "slide.new-blank",
    label: "New slides start blank",
    icon: "rectangle-horizontal",
    checked: (_, ui) => ui.newSlides === "blank",
    run: ({ ui }) => ui.setNewSlides("blank"),
  },
  {
    id: "slide.new-same",
    label: "New slides copy the current layout",
    icon: "layout-template",
    checked: (_, ui) => ui.newSlides === "same",
    run: ({ ui }) => ui.setNewSlides("same"),
  },
  {
    id: "slide.duplicate",
    label: "Duplicate slide",
    icon: "copy-plus",
    keys: ["Mod+D"],
    scope: "filmstrip",
    enabled: many,
    run: ({ session }) => void session.slides.duplicate(),
  },
  {
    id: "slide.delete",
    label: "Delete slide",
    icon: "trash",
    keys: ["Delete", "Backspace"],
    scope: "filmstrip",
    enabled: many,
    run: ({ session }) => session.slides.remove(),
  },
  {
    id: "slide.skip",
    label: "Skip slide",
    icon: "eye-off",
    enabled: many,
    checked: (s) => s.deck.slides.filter((x) => s.slideSelection.includes(x.id)).every((x) => x.hidden),
    run: ({ session }) => {
      const chosen = session.state.deck.slides.filter((x) => session.state.slideSelection.includes(x.id));
      session.slides.setFlags({ hidden: !chosen.every((x) => x.hidden) });
    },
  },
  {
    id: "slide.backup",
    label: "Backup slide",
    icon: "layers",
    enabled: (s) => many(s) && s.deck.slides[0]?.id !== s.slideSelection[0],
    checked: (s) => s.deck.slides.filter((x) => s.slideSelection.includes(x.id)).every((x) => x.backup),
    run: ({ session }) => {
      const chosen = session.state.deck.slides.filter((x) => session.state.slideSelection.includes(x.id));
      session.slides.setFlags({ backup: !chosen.every((x) => x.backup) });
    },
  },
  {
    id: "slide.up",
    label: "Move slide up",
    icon: "arrow-up",
    keys: ["Mod+Alt+Up"],
    scope: "filmstrip",
    run: ({ session }) => session.slides.moveBy(-1),
  },
  {
    id: "slide.down",
    label: "Move slide down",
    icon: "arrow-down",
    keys: ["Mod+Alt+Down"],
    scope: "filmstrip",
    run: ({ session }) => session.slides.moveBy(1),
  },
  {
    id: "slide.to-start",
    label: "Move slide to beginning",
    icon: "arrow-up-to-line",
    keys: ["Mod+Alt+Shift+Up"],
    scope: "filmstrip",
    run: ({ session }) => session.slides.moveBy(-Infinity),
  },
  {
    id: "slide.to-end",
    label: "Move slide to end",
    icon: "arrow-down-to-line",
    keys: ["Mod+Alt+Shift+Down"],
    scope: "filmstrip",
    run: ({ session }) => session.slides.moveBy(Infinity),
  },
  {
    id: "slide.previous",
    label: "Previous slide",
    icon: "chevron-left",
    keys: ["PageUp"],
    scope: "canvas",
    run: ({ session }) => session.goBy(-1),
  },
  {
    id: "slide.next",
    label: "Next slide",
    icon: "chevron-right",
    keys: ["PageDown"],
    scope: "canvas",
    run: ({ session }) => session.goBy(1),
  },
  {
    id: "slide.layout",
    label: "Change layout…",
    icon: "rectangle-horizontal",
    run: ({ ui }) => ui.openDialog("layouts"),
  },
  {
    id: "slide.background",
    label: "Change background…",
    icon: "palette",
    run: ({ ui }) => ui.openDialog("background"),
  },
  {
    id: "slide.transition",
    label: "Transition…",
    icon: "film",
    // The panel beside the slide, where the choice plays on the slide as it is made.
    run: ({ ui }) => ui.openPanel("transitions"),
  },
  {
    id: "slide.theme",
    label: "Edit theme…",
    icon: "palette",
    run: ({ ui }) => ui.openDialog("theme"),
  },
  {
    id: "slide.add-section",
    label: "Add section here",
    icon: "between-horizontal-start",
    enabled: (s) => {
      const at = anchorOf(s);
      return at !== "" && !(s.deck.sections ?? []).some((section) => section.startsAt === at);
    },
    run: ({ session, ui }) => {
      // The name is asked for next, in the header the section has just been given.
      const at = session.slides.addSection();
      if (at) requestFieldFocus(ui, sectionField(at));
    },
  },
  {
    id: "slide.rename-section",
    label: "Rename section",
    icon: "pen-line",
    enabled: (s) => sectionHere(s) !== undefined,
    run: ({ session, ui }) => {
      const section = sectionHere(session.state);
      if (section) requestFieldFocus(ui, sectionField(section.startsAt));
    },
  },
  {
    id: "slide.remove-section",
    label: "Remove section",
    icon: "trash",
    enabled: (s) => sectionHere(s) !== undefined,
    run: ({ session }) => {
      const section = sectionHere(session.state);
      if (section) session.slides.removeSection(section.startsAt);
    },
  },
];
