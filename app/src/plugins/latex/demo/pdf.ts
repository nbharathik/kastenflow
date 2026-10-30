// A small PDF writer for the demo: pages of positioned lines in the PDF
// standard fonts (Times), so a "build" can answer real PDF bytes without
// Tectonic, and the preview's own PDF library draws them. Text only, Latin-1.

export type Face = "roman" | "bold" | "italic";

/** One line of text on a page; `x` and `y` are points from the page's bottom left. */
export interface Placed {
  text: string;
  face: Face;
  size: number;
  x: number;
  y: number;
}

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

const FONT: Record<Face, { name: string; base: string }> = {
  roman: { name: "F1", base: "Times-Roman" },
  bold: { name: "F2", base: "Times-Bold" },
  italic: { name: "F3", base: "Times-Italic" },
};

/** Marks the PDF standard fonts have no letter for become the nearest plain ones. */
const SWAPS: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "...", "≠": "!=", "≤": "<=", "≥": ">=", "→": "->", "−": "-" };

/** A PDF string literal for `text`: Latin-1, with the marks a literal must escape. */
export function literal(text: string): string {
  let out = "";
  for (const char of text) {
    const swapped = SWAPS[char] ?? char;
    for (const c of swapped) {
      const code = c.charCodeAt(0);
      if (c === "(" || c === ")" || c === "\\") out += `\\${c}`;
      else if (code >= 32 && code < 127) out += c;
      else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
      else out += "?";
    }
  }
  return `(${out})`;
}

function content(lines: readonly Placed[]): string {
  const parts = lines
    .filter((line) => line.text.length > 0)
    .map((line) => `BT /${FONT[line.face].name} ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm ${literal(line.text)} Tj ET`);
  return parts.join("\n");
}

/** A valid PDF of `pages`; an empty list still makes one blank page. */
export function makePdf(pages: readonly (readonly Placed[])[]): Uint8Array {
  const sheets = pages.length > 0 ? pages : [[]];
  // 1 catalog, 2 pages, 3 to 5 fonts, then a page object and its stream for each sheet.
  const objects: string[] = [];
  const kids = sheets.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${sheets.length} >>`);
  for (const face of ["roman", "bold", "italic"] as const) objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT[face].base} /Encoding /WinAnsiEncoding >>`);
  sheets.forEach((lines, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
    const stream = content(lines);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every mark was reduced to ASCII above, so one byte is one character.
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
