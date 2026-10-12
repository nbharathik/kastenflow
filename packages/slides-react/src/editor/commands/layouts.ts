import { resetSlides } from "../layouts/ops.ts";
import type { Command } from "./types.ts";

/** Whether the host the editor runs in keeps templates (the standalone page does not). */
const keepsTemplates = (_: unknown, __: unknown, host: { templates?: unknown }): boolean => host.templates !== undefined;

/** The layouts and templates a person keeps: saving a slide as a layout, changing one, putting slots back, and a deck's look as a template. */
export const layoutCommands: Command[] = [
  {
    id: "slide.save-as-layout",
    label: "Save slide as layout…",
    icon: "layout-template",
    run: ({ ui }) => ui.openDialog("layout-save"),
  },
  {
    id: "slide.reset-layout",
    label: "Reset slide to layout",
    icon: "rotate-ccw",
    run: ({ session }) => resetSlides(session),
  },
  {
    id: "layout.edit",
    label: "Edit this layout…",
    icon: "pen-line",
    run: ({ session, ui }) => ui.openLayoutDesign(session.slide.layout),
  },
  {
    id: "layout.manage",
    label: "Manage layouts…",
    icon: "layers",
    run: ({ ui }) => ui.openDialog("layouts-manage"),
  },
  {
    id: "slide.new-mine",
    label: "New slides use my default layout",
    icon: "star",
    checked: (_, ui) => ui.newSlides === "mine",
    run: ({ ui }) => ui.setNewSlides("mine"),
  },
  {
    id: "deck.save-template",
    label: "Save as template…",
    icon: "file-plus",
    enabled: keepsTemplates,
    run: ({ ui }) => ui.openDialog("template-save"),
  },
  {
    id: "deck.apply-template",
    label: "Apply a template…",
    icon: "palette",
    enabled: keepsTemplates,
    run: ({ ui }) => ui.openDialog("template-apply"),
  },
];
