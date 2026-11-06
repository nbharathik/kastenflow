// Which picture is being cropped, if any. Crop mode is a moment of the editor, not part of the deck.

let current: string | null = null;
const listeners = new Set<() => void>();

export const cropMode = {
  get: (): string | null => current,
  set(id: string | null): void {
    if (id === current) return;
    current = id;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
