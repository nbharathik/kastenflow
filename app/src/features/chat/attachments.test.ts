import { describe, expect, it } from "vitest";

import {
  AttachRefused,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  classify,
  formatSize,
  labelOf,
  pastedText,
  prepare,
  shouldAttachPaste,
  type AttachDeps,
  type ImageSource,
  type PdfText,
} from "./attachments";

const file =(parts: BlobPart[], name: string, type = "") => new File(parts, name, { type });
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

/** A picture of `width` by `height` whose encoded size is `size(w, h, mime, quality)`. */
function picture(width: number, height: number, size: (w: number, h: number, mime: string, q: number) => number = () => 1000): ImageSource & { encoded: [number, number, string, number][] } {
  const encoded: [number, number, string, number][] = [];
  return {
    width,
    height,
    encoded,
    async encode(w, h, mime, q) {
      encoded.push([w, h, mime, q]);
      return new Uint8Array(size(w, h, mime, q));
    },
  };
}

function deps(over: Partial<AttachDeps> = {}): AttachDeps {
  return {
    decodeImage: async () => picture(100, 80),
    readPdf: async () => ({ text: "", first: 1, last: 1, total: 1, cut: false }),
    now: () => new Date(2026, 9, 12, 14, 5, 9),
    ...over,
  };
}

const refusal = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AttachRefused);
  return (err as Error).message;
};

describe("a long paste", () => {
  it("is an attachment past 2,000 characters or 40 lines", () => {
    expect(shouldAttachPaste("x".repeat(2000))).toBe(false);
    expect(shouldAttachPaste("x".repeat(2001))).toBe(true);
    expect(shouldAttachPaste(Array.from({ length: 40 }, () => "a").join("\n"))).toBe(false);
    expect(shouldAttachPaste(Array.from({ length: 41 }, () => "a").join("\n"))).toBe(true);
    expect(shouldAttachPaste("")).toBe(false);
  });

  it("keeps the text as it was pasted, and counts its characters", () => {
    const text = `${"é".repeat(2500)}\n`;
    const made = pastedText(text);
    expect(made).toMatchObject({ name: "Pasted text", kind: "text", mime: "text/plain", chars: 2501 });
    expect(decode(made.bytes)).toBe(text);
    expect(labelOf(made)).toBe("Pasted text · 2,501 chars");
  });

  it("is cut at the most the assistant reads, and says so", () => {
    const made = pastedText("y".repeat(MAX_TEXT_CHARS + 50));
    expect(made.chars).toBe(MAX_TEXT_CHARS);
    expect(made.note).toMatch(/200,000/);
  });
});

describe("sizes and names", () => {
  it("writes sizes short", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(4096)).toBe("4 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1_250_000)).toBe("1.2 MB");
  });

  it("labels a file by its name and size, and a picture by its name", async () => {
    const made = await prepare(file(["a,b\n1,2\n"], "numbers.csv", "text/csv"), deps());
    expect(labelOf(made)).toBe("numbers.csv · 8 B");
    const image = await prepare(file([new Uint8Array(10)], "shot.png", "image/png"), deps());
    expect(labelOf(image)).toBe("shot.png · 10 B");
  });
});

describe("what a file is", () => {
  it("is text by its extension or type, a picture by its type, or a PDF", () => {
    expect(classify(file([""], "notes.md"))).toBe("text");
    expect(classify(file([""], "main.rs"))).toBe("text");
    expect(classify(file([""], "data", "application/json"))).toBe("text");
    expect(classify(file([""], "page.svg", "image/svg+xml"))).toBe("text");
    expect(classify(file([""], "scan.PDF"))).toBe("pdf");
    expect(classify(file([""], "x", "application/pdf"))).toBe("pdf");
    expect(classify(file([""], "a.png", "image/png"))).toBe("image");
    expect(classify(file([""], "b.JPG"))).toBe("image");
    expect(classify(file([""], "c", "image/webp"))).toBe("image");
    expect(classify(file([""], "d.gif"))).toBe("image");
    expect(classify(file([""], "e.heic"))).toBe("picture-unsupported");
    expect(classify(file([""], "f.avif", "image/avif"))).toBe("picture-unsupported");
    expect(classify(file([""], "g.bmp"))).toBe("picture-unsupported");
    expect(classify(file([""], "h.zip", "application/zip"))).toBe("other");
    expect(classify(file([""], "Makefile"))).toBe("other");
  });
});

describe("text files", () => {
  it("are read as UTF-8, a byte-order mark dropped", async () => {
    const made = await prepare(file([new Uint8Array([0xef, 0xbb, 0xbf]), "héllo\nworld"], "notes.md", "text/markdown"), deps());
    expect(made).toMatchObject({ name: "notes.md", kind: "text", mime: "text/plain", chars: 11 });
    expect(decode(made.bytes)).toBe("héllo\nworld");
  });

  it("are refused when they are not UTF-8 or hold binary", async () => {
    const latin = await refusal(prepare(file([new Uint8Array([0x63, 0x61, 0x66, 0xe9])], "old.txt", "text/plain"), deps()));
    expect(latin).toMatch(/old\.txt/);
    expect(latin).toMatch(/UTF-8/);
    const binary = await refusal(prepare(file([new Uint8Array([0x41, 0x00, 0x42])], "weird.log"), deps()));
    expect(binary).toMatch(/weird\.log/);
  });

  it("are refused over a megabyte, with what to do instead", async () => {
    const big = new File([new Uint8Array(MAX_TEXT_BYTES + 1)], "huge.log", { type: "text/plain" });
    const sentence = await refusal(prepare(big, deps()));
    expect(sentence).toMatch(/huge\.log/);
    expect(sentence).toMatch(/1 MB/);
  });

  it("are cut at the most the assistant reads, and the note says so", async () => {
    const made = await prepare(file(["z".repeat(MAX_TEXT_CHARS + 10)], "long.txt", "text/plain"), deps());
    expect(made.chars).toBe(MAX_TEXT_CHARS);
    expect(made.note).toMatch(/200,000/);
  });

  it("include SVG, which is text, and an unknown extension that reads as text", async () => {
    const svg = await prepare(file(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.svg", "image/svg+xml"), deps());
    expect(svg.kind).toBe("text");
    const odd = await prepare(file(["fn main() {}\n"], "build.zig"), deps());
    expect(odd).toMatchObject({ kind: "text", name: "build.zig" });
  });

  it("refuse other files in a plain sentence, naming the file", async () => {
    const sentence = await refusal(prepare(file([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 1, 2])], "bundle.zip", "application/zip"), deps()));
    expect(sentence).toMatch(/bundle\.zip/);
    expect(sentence).toMatch(/text|PDF|picture/);
  });
});

describe("pictures", () => {
  it("go as they are when they are small enough", async () => {
    const source = picture(800, 600);
    const made = await prepare(file([new Uint8Array(4000)], "diagram.png", "image/png"), deps({ decodeImage: async () => source }));
    expect(made).toMatchObject({ name: "diagram.png", kind: "image", mime: "image/png", width: 800, height: 600 });
    expect(made.bytes.length).toBe(4000);
    expect(source.encoded).toEqual([]);
    expect(made.note).toBeUndefined();
  });

  it("are scaled so the longest side is at most 2,048 pixels, keeping their shape", async () => {
    const source = picture(4096, 3072, () => 900_000);
    const made = await prepare(file([new Uint8Array(6_000_000)], "photo.jpg", "image/jpeg"), deps({ decodeImage: async () => source }));
    expect(source.encoded[0]).toEqual([MAX_IMAGE_SIDE, 1536, "image/jpeg", 0.9]);
    expect(made).toMatchObject({ kind: "image", mime: "image/jpeg", width: 2048, height: 1536, name: "photo.jpg" });
    expect(made.note).toMatch(/2,?048/);
  });

  it("are scaled when only their weight is over 5 MB", async () => {
    const source = picture(2000, 1000, (_w, _h, mime) => (mime === "image/png" ? MAX_IMAGE_BYTES + 1 : 400_000));
    const made = await prepare(file([new Uint8Array(MAX_IMAGE_BYTES + 5)], "shot.png", "image/png"), deps({ decodeImage: async () => source }));
    // PNG first (it keeps transparency); then a JPEG, with the name's ending following.
    expect(source.encoded.map(([, , mime]) => mime)).toEqual(["image/png", "image/jpeg"]);
    expect(made).toMatchObject({ mime: "image/jpeg", name: "shot.jpg", width: 2000, height: 1000 });
    expect(made.bytes.length).toBe(400_000);
  });

  it("shrink further, step by step, until they fit", async () => {
    const source = picture(2000, 2000, (w, h) => (w * h > 1_000_000 ? MAX_IMAGE_BYTES + 1 : 1_000_000));
    const made = await prepare(file([new Uint8Array(MAX_IMAGE_BYTES * 2)], "huge.jpg", "image/jpeg"), deps({ decodeImage: async () => source }));
    expect(made.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(made.width! * made.height!).toBeLessThanOrEqual(1_000_000);
    expect(Math.max(made.width!, made.height!)).toBeLessThan(2000);
  });

  it("are refused when they will not fit at any size, or will not open", async () => {
    const stubborn = picture(1000, 1000, () => MAX_IMAGE_BYTES + 1);
    expect(await refusal(prepare(file([new Uint8Array(MAX_IMAGE_BYTES + 1)], "noise.png", "image/png"), deps({ decodeImage: async () => stubborn })))).toMatch(/noise\.png/);
    const broken = deps({
      decodeImage: async () => {
        throw new Error("bad data");
      },
    });
    expect(await refusal(prepare(file([new Uint8Array(30)], "broken.png", "image/png"), broken))).toMatch(/broken\.png/);
  });

  it("are refused in kinds the assistant cannot see, naming the kinds it can", async () => {
    const sentence = await refusal(prepare(file([new Uint8Array(30)], "photo.heic", "image/heic"), deps()));
    expect(sentence).toMatch(/photo\.heic/);
    expect(sentence).toMatch(/PNG, JPEG, GIF/);
  });

  it("are named after when they were pasted, when they come without a name", async () => {
    const made = await prepare(file([new Uint8Array(30)], "image.png", "image/png"), deps());
    expect(made.name).toBe("Pasted image 2026-10-12 140509.png");
  });
});

describe("PDFs", () => {
  const pdf = (over: Partial<PdfText> = {}): AttachDeps => deps({ readPdf: async () => ({ text: "--- Page 1 ---\nHello", first: 1, last: 10, total: 42, cut: false, ...over }) });

  it("become a text attachment named for the pages read", async () => {
    const made = await prepare(file([new Uint8Array(20)], "paper.pdf", "application/pdf"), pdf());
    expect(made).toMatchObject({ name: "paper.pdf (pages 1–10)", kind: "text", mime: "text/plain" });
    expect(decode(made.bytes)).toContain("Hello");
    expect(made.note).toMatch(/10 of 42/);
  });

  it("name a single page, and say nothing of pages left out when it was all", async () => {
    const one = await prepare(file([new Uint8Array(20)], "form.pdf"), pdf({ first: 1, last: 1, total: 1 }));
    expect(one.name).toBe("form.pdf (page 1)");
    expect(one.note).toBeUndefined();
  });

  it("say when the characters ran out first", async () => {
    const made = await prepare(file([new Uint8Array(20)], "book.pdf"), pdf({ last: 7, cut: true, total: 300 }));
    expect(made.name).toBe("book.pdf (pages 1–7)");
    expect(made.note).toMatch(/30,000/);
  });

  it("are refused when they have no text, or will not open", async () => {
    expect(await refusal(prepare(file([new Uint8Array(20)], "scan.pdf"), pdf({ text: "  \n " })))).toMatch(/scan\.pdf.*no text/);
    const broken = deps({
      readPdf: async () => {
        throw new Error("Invalid PDF structure");
      },
    });
    expect(await refusal(prepare(file([new Uint8Array(20)], "bad.pdf"), broken))).toMatch(/bad\.pdf/);
  });
});
