// Names of diagrams, as kasten-core makes them (crates/kasten-core/src/diagrams/
// names.rs). A diagram has no title inside its file, so its title is its file's
// name: `OAuth-flow.drawio` reads "OAuth flow". The name keeps the case it was
// typed in and is otherwise made as every file name is.

export const DIAGRAM_EXT = ".drawio";
export const PICTURE_EXT = ".drawio.svg";

const MAX_CHARS = 80;
const MAX_BYTES = 120;
const encoder = new TextEncoder();

/** Whether Windows keeps the name for a device (`con`, `nul`, `com1`…). */
function windowsDevice(name: string): boolean {
  const base = (name.split(".")[0] ?? name).trimEnd().toLowerCase();
  return ["con", "prn", "aux", "nul", "conin$", "conout$"].includes(base) || /^(com|lpt)[0-9¹²³]$/.test(base);
}

/** A file-name-safe stem from a title, keeping its case: letters and digits of
 * any script stay, everything else becomes one dash; `untitled` when nothing
 * usable remains. */
export function stemOfTitle(title: string): string {
  let out = "";
  let bytes = 0;
  let chars = 0;
  let dash = false;
  for (const c of title) {
    const alnum = /[\p{L}\p{N}]/u.test(c);
    if (alnum) {
      const gap = dash && out !== "";
      const size = encoder.encode(c).length;
      if (bytes + (gap ? 1 : 0) + size > MAX_BYTES) break;
      if (gap) {
        out += "-";
        bytes += 1;
      }
      out += c;
      bytes += size;
      chars += 1 + (gap ? 1 : 0);
    }
    dash = !alnum;
    if (chars >= MAX_CHARS) break;
  }
  if (out === "") return "untitled";
  return windowsDevice(out) ? `${out}-1` : out;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A file's name without its folder or extension. */
export function stemOfPath(path: string): string {
  const name = fileName(path);
  if (name.endsWith(PICTURE_EXT)) return name.slice(0, -PICTURE_EXT.length);
  if (name.endsWith(DIAGRAM_EXT)) return name.slice(0, -DIAGRAM_EXT.length);
  return name;
}

/** What people call the diagram at `path`: its file's name with the dashes and underscores read as spaces. */
export function titleOfPath(path: string): string {
  const title = stemOfPath(path).replace(/[-_]/g, " ").trim();
  return title === "" ? fileName(path) : title;
}

/** The source's path for a title in a folder, before any number is added. */
export const pathFor = (dir: string, title: string) => `${dir}/${stemOfTitle(title)}${DIAGRAM_EXT}`;

/** The picture's path, from the source's. */
export const pictureOf = (path: string) => `${path}.svg`;

export const isDiagramPath = (path: string) => path.endsWith(DIAGRAM_EXT);

/** Whether a link or a card names a diagram's picture, which shows the diagram too. */
export const isPicturePath = (path: string) => path.endsWith(PICTURE_EXT);

/** The source's path for either of a diagram's two files. */
export const sourceOf = (path: string) => (isPicturePath(path) ? path.slice(0, -4) : path);

/** The text of a title that may name a diagram: no [ ] | or control characters (kasten-core `checked_title`). */
export const validTitle = (title: string) => title.trim() !== "" && !/[[\]|]/.test(title) && !/\p{Cc}/u.test(title);
