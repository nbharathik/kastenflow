/** A steady cover colour of the book's own, from its title. */
export function cover(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 48% 52%), hsl(${(hue + 36) % 360} 52% 40%))`;
}

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
