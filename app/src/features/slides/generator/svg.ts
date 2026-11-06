// Small facts about the pictures code draws, read from their text or their header.

/** The size an SVG says it is: its `width` and `height`, else its `viewBox`. Null when it says neither. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attribute = (name: string): number => Number(new RegExp(`\\s${name}="([0-9]+(?:\\.[0-9]+)?)(?:px)?"`).exec(tag)?.[1] ?? Number.NaN);
  const [width, height] = [attribute("width"), attribute("height")];
  if (width > 0 && height > 0) return { width, height };
  const box = /\sviewBox="([^"]+)"/.exec(tag)?.[1];
  const numbers = box ? box.trim().split(/[\s,]+/).map(Number) : [];
  const [w, h] = [numbers[2], numbers[3]];
  return numbers.length === 4 && w !== undefined && h !== undefined && w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** The width and height of a PNG, from its first chunk; null when these bytes are not one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
