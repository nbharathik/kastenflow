// What the insert palette lists: things to put on the slide, layouts to add as
// a slide, the pictures the host holds, and every command that can be done now.

import { type CommandContext, COMMANDS, isEnabled, keysOf, runCommand } from "../commands/index.ts";
import { fitted, image, line, shape, textBox } from "../factory.ts";
import type { HostImage } from "../host.ts";
import { freeBox, insertPlaced } from "../insert-composite.ts";
import { INSERT_ENTRIES, groupLabel, insertItems } from "../insert/model.ts";
import { newSlideLayouts } from "../new-slide.ts";
import { markFresh } from "../quick-add/fresh.ts";
import { LINES, SHAPE_GROUPS, CLICK_SIZE } from "../shapes.ts";
import type { IconName } from "../ui/icons.ts";
import type { Searchable } from "./palette-rank.ts";

/** The sections of the gallery, in the order they are listed: the groups of the Insert menu, then slides, the pictures the host holds, and commands. */
export const SECTIONS = ["Text & content", "Media", "Shapes & lines", "Data", "Pages & links", "Smart parts", "Slides", "Images", "Commands"] as const;
export type Section = (typeof SECTIONS)[number];

export interface PaletteItem extends Searchable {
  id: string;
  group: Section;
  icon?: IconName;
  /** A preset shape, drawn small beside the name. */
  shape?: string;
  /** What it makes, in a line under its name. */
  description?: string;
  /** What kind of thing it is, said at the right when no keys are. */
  hint?: string;
  /** The keys that do the same, as they read on this system. */
  keys?: string;
  run(context: CommandContext): void | Promise<void>;
}

const NONE = { x: 0, y: 0, w: 0, h: 0 };

/** What the commands of each family are called in the palette. */
const AREA_NAMES: Record<string, string> = {
  edit: "Edit",
  text: "Text",
  slide: "Slide",
  steps: "Steps",
  arrange: "Arrange",
  view: "View",
  file: "File",
  help: "Help",
  present: "Present",
  lint: "Check",
  import: "Import",
};

const areaOf = (id: string): string => {
  const family = id.split(".")[0] ?? id;
  return AREA_NAMES[family] ?? family.charAt(0).toUpperCase() + family.slice(1);
};

/**
 * What is put on the slide, from the one list the Insert menu is made from: each item with the line that says what it makes, and
 * its keys. A text box is added at once (the menu arms the tool, to place it with a click); a page or a diagram only where the host has them.
 */
function inserts(context: CommandContext): PaletteItem[] {
  return insertItems(context)
    .filter((item) => item.enabled)
    .map(
      (item): PaletteItem => ({
        id: `palette.${item.command.replace(/^insert\./, "")}`,
        group: groupLabel(item.group) as Section,
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        description: item.description,
        keywords: item.keywords,
        ...(item.keys ? { keys: item.keys } : {}),
        run: (ctx) => {
          if (item.command !== "insert.text-box") return runCommand(item.command, ctx);
          const id = insertPlaced(ctx.session, textBox(NONE, ""), CLICK_SIZE.text);
          if (!id) return;
          // Like the text tool and the T key: closed with nothing typed, the empty box goes again.
          markFresh(ctx.session, id);
          ctx.session.startEditing(id);
        },
      }),
    );
}

/** Every preset shape and every kind of line, put on the slide where there is room. */
function shapes(): PaletteItem[] {
  const presets = SHAPE_GROUPS.flatMap((group) =>
    group.shapes.map(
      (entry): PaletteItem => ({
        id: `palette.shape.${entry.preset}`,
        group: "Shapes & lines",
        label: entry.label,
        shape: entry.preset,
        hint: group.title === "Shapes" ? "Shape" : group.title.replace(/s$/, ""),
        keywords: ["shape"],
        run: ({ session }) => void insertPlaced(session, shape(entry.preset, NONE), CLICK_SIZE.shape),
      }),
    ),
  );
  const lines = LINES.map(
    (entry): PaletteItem => ({
      id: `palette.${entry.tool}`,
      group: "Shapes & lines",
      label: entry.label,
      icon: "arrow-up-right",
      hint: "Line",
      keywords: ["line", "connector", "arrow"],
      run: ({ session }) => {
        const [kind, route] = entry.tool.split(":") as ["line" | "arrow", "straight" | "elbow" | "curved"];
        // Across the middle of the free place, left to right.
        const box = freeBox(session, { w: 240, h: 60 });
        const y = box.y + box.h / 2;
        session.elements.insert([line(route, kind === "arrow", { x: box.x, y }, { x: box.x + box.w, y })]);
      },
    }),
  );
  return [...presets, ...lines];
}

/** A new slide on each layout of the theme. */
const slides = ({ session }: CommandContext): PaletteItem[] =>
  newSlideLayouts(session).map((layout) => ({
    id: `palette.slide.${layout.name}`,
    group: "Slides",
    label: `New slide: ${layout.label}`,
    icon: "layout-template",
    keywords: ["add", "layout"],
    run: () => void session.slides.add({ layout: layout.name }),
  }));

/** The pictures the host holds, each placed on the slide at a size that suits it. */
const pictures = (images: readonly HostImage[]): PaletteItem[] =>
  images.map((held) => ({
    id: `palette.image.${held.path}`,
    group: "Images",
    label: `Image: ${held.name}`,
    icon: "image",
    keywords: ["picture", "gallery"],
    run: ({ session }) => {
      const size = fitted({ w: held.width ?? 640, h: held.height ?? 400 }, session.deck.size);
      insertPlaced(session, image(held.path, NONE, held.name.replace(/\.[^.]+$/, "")), size);
    },
  }));

/** Every command that can be done now, apart from the ones that insert, which the palette does in its own way. */
function commands(context: CommandContext): PaletteItem[] {
  const listed = new Set(INSERT_ENTRIES.map((entry) => entry.command));
  return [...COMMANDS.values()]
    .filter((command) => !command.id.startsWith("insert.") && !listed.has(command.id) && isEnabled(command, context))
    .map((command) => {
      const keys = keysOf(command.id);
      return {
        id: command.id,
        group: "Commands" as const,
        label: command.label,
        ...(command.icon ? { icon: command.icon } : {}),
        hint: areaOf(command.id),
        ...(keys ? { keys } : {}),
        run: (ctx: CommandContext) => runCommand(command.id, ctx),
      };
    });
}

/** The whole list of the palette for this editor, in the order of its sections. */
export function paletteItems(context: CommandContext, held: readonly HostImage[] = []): PaletteItem[] {
  const found = [...inserts(context), ...shapes(), ...slides(context), ...pictures(held), ...commands(context)];
  // In the order of the sections, so the groups of the menu read the same here.
  return SECTIONS.flatMap((section) => found.filter((item) => item.group === section));
}
