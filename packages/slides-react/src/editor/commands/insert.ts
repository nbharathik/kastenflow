import { fitted, image } from "../factory.ts";
import { pickFiles, readImage } from "../files.ts";
import { pastedName } from "../gallery/files.ts";
import { addShapeNow, addTextBoxCentred, addTextBoxNow } from "../quick-add/add.ts";
import { LINES, SHAPE_GROUPS } from "../shapes.ts";
import type { Command, CommandContext } from "./types.ts";

/** How pictures given to `insertImageFiles` came, and where on the slide they go. */
export interface ImageFilesOptions {
  /** `pasted` or `file` (the default is left to the host); recorded with the image. */
  source?: "pasted" | "file";
  /** The middle of the first picture, in slide units, when they are dropped; otherwise the middle of the slide. */
  at?: { x: number; y: number };
}

/**
 * Stores each image file with the host and places it on the slide, fitted and centred (or centred on the
 * drop), one after another a little apart. The same picture kept before is the same image: the host says so.
 */
export async function insertImageFiles({ session }: Pick<CommandContext, "session">, files: File[], options: ImageFilesOptions = {}): Promise<void> {
  const size = session.deck.size;
  const elements = [];
  for (const [i, file] of files.entries()) {
    const read = await readImage(file);
    const name = options.source === "pasted" ? pastedName(file, new Date()) : read.name;
    const path = await session.host.addImage(name, read.bytes, options.source ? { source: options.source } : undefined);
    const box = fitted(read.size ?? { w: 640, h: 400 }, size);
    const middle = options.at ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const x = Math.min(Math.max(Math.round(middle.x - box.w / 2), 0), Math.max(size.w - box.w, 0));
    const y = Math.min(Math.max(Math.round(middle.y - box.h / 2), 0), Math.max(size.h - box.h, 0));
    elements.push(image(path, { ...box, x: x + i * 16, y: y + i * 16 }, read.name.replace(/\.[^.]+$/, "")));
  }
  if (elements.length > 0) session.elements.insert(elements);
}

// The keys of Insert are single letters, so they are for when the slide has the keys ("stage"): not in a text box, a field, the
// filmstrip, a panel or a toolbar button, and no chord with Ctrl, Cmd or Alt is one of them.

/** The shapes that a key adds at once, at the pointer. */
const SHAPE_KEYS: Readonly<Record<string, string>> = { rect: "R", ellipse: "O" };

/** The lines whose key arms the tool: a line needs two points, so it is drawn. */
const LINE_KEYS: Readonly<Record<string, string>> = { "line:straight": "L", "arrow:straight": "A" };

const shapeCommands: Command[] = SHAPE_GROUPS.flatMap((group) =>
  group.shapes.map((shape): Command => {
    const key = SHAPE_KEYS[shape.preset];
    return {
      id: `insert.shape.${shape.preset}`,
      label: shape.label,
      run: ({ session }) => session.setTool(`shape:${shape.preset}`),
      ...(key ? { keys: [key], scope: "stage" as const, byKey: (context: CommandContext) => addShapeNow(context, shape.preset) } : {}),
    };
  }),
);

const lineCommands: Command[] = LINES.map((line): Command => {
  const key = LINE_KEYS[line.tool];
  return {
    id: `insert.${line.tool.replace(":", ".")}`,
    label: line.label,
    run: ({ session }) => session.setTool(line.tool),
    ...(key ? { keys: [key], scope: "stage" as const } : {}),
  };
});

/** Insert: what goes onto the slide. */
export const insertCommands: Command[] = [
  {
    id: "insert.select",
    label: "Select",
    icon: "mouse-pointer-2",
    run: ({ session }) => session.setTool("select"),
  },
  {
    id: "insert.text-box",
    label: "Text box",
    icon: "type",
    // The button and the menu put a box in the middle of the slide at once, ready to type; the key adds one at the pointer.
    keys: ["T"],
    scope: "stage",
    run: (context) => addTextBoxCentred(context),
    byKey: (context) => addTextBoxNow(context),
  },
  {
    id: "insert.image",
    label: "Image from computer…",
    icon: "image",
    run: async (context) => insertImageFiles(context, await pickFiles("image/*", true)),
  },
  {
    id: "insert.gallery",
    label: "Image from the gallery…",
    icon: "image-plus",
    keys: ["I"],
    scope: "stage",
    checked: (_state, ui) => ui.galleryOpen,
    run: ({ ui }) => ui.toggleGallery(),
  },
  {
    id: "insert.table",
    label: "Table…",
    icon: "table",
    run: ({ ui }) => ui.openDialog("table"),
  },
  ...shapeCommands,
  ...lineCommands,
];
