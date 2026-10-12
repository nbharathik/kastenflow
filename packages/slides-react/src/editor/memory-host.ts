import type { ComponentType } from "react";

import type { AiPanelProps, DeliveredFile, HostImage, ImageEdit, ImageUse, SaveOutcome, SlidesHost } from "./host.ts";
import type { TemplatesHost } from "./layouts/templates-host.ts";

/**
 * A host that keeps everything in memory: the deck's last saved text, the images
 * added, and the files delivered. For tests, demos and the standalone page.
 */
export class MemoryHost implements SlidesHost {
  saved: string | null = null;
  readonly saves: string[] = [];
  readonly delivered: DeliveredFile[] = [];
  readonly notices: string[] = [];
  private readonly stored = new Map<string, { image: HostImage; url: string; bytes: Uint8Array }>();
  /** What the next save answers. */
  answer: SaveOutcome = { status: "saved" };
  /** The assistant tab, for a test to give. */
  aiPanel?: ComponentType<AiPanelProps>;
  /** Where images are used, for a test to set: what `imageUsage` answers. */
  usage: Record<string, ImageUse> = {};
  /** The templates, for a test to give: none unless it does. */
  templates?: TemplatesHost;
  private readonly watchers = new Set<() => void>();
  private last = 0;

  constructor(private readonly download?: (file: DeliveredFile) => void) {}

  async save(text: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
    // Keeping the editor's version over the file's is the person's choice, and it always works.
    if (this.answer.status === "saved" || options?.overwrite) {
      this.saved = text;
      this.saves.push(text);
      return { status: "saved" };
    }
    return this.answer;
  }

  imageUrl(path: string): string | undefined {
    return this.stored.get(path)?.url;
  }

  async addImage(name: string, bytes: Uint8Array, options?: { source?: "pasted" | "file" | "pptx-import"; deck?: string }): Promise<string> {
    // The same bytes are the same image, whatever they are called.
    for (const entry of this.stored.values()) if (entry.bytes.length === bytes.length && entry.bytes.every((byte, i) => byte === bytes[i])) return entry.image.path;
    const base = name.replace(/[^\w.-]+/g, "-");
    let path = `assets/${base}`;
    for (let n = 2; this.stored.has(path); n++) path = `assets/${base.replace(/(\.[^.]*)?$/, `-${n}$1`)}`;
    const type = /\.svg$/i.test(name) ? "image/svg+xml" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.gif$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : "image/png";
    let url = `memory:${path}`;
    try {
      if (typeof URL.createObjectURL === "function") url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    } catch {
      // No object URLs here (a test's page): the picture is still kept, under a name of its own.
    }
    this.last = Math.max(Date.now(), this.last + 1);
    this.stored.set(path, { image: { path, name, bytes: bytes.length, added: this.last, source: options?.source ?? "file", ...(options?.deck ? { deck: options.deck } : {}), createdBy: "person", tags: [] }, url, bytes });
    for (const watcher of [...this.watchers]) watcher();
    return path;
  }

  async readImage(path: string): Promise<Uint8Array | undefined> {
    return this.stored.get(path)?.bytes;
  }

  async images(): Promise<HostImage[]> {
    return [...this.stored.values()].map((entry) => entry.image).sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  }

  async assetInfo(path: string): Promise<HostImage | undefined> {
    return this.stored.get(path)?.image;
  }

  async setImageMeta(path: string, edit: ImageEdit): Promise<HostImage | undefined> {
    const entry = this.stored.get(path);
    if (!entry) return undefined;
    entry.image = {
      ...entry.image,
      ...(edit.tags ? { tags: edit.tags } : {}),
      ...(edit.caption !== undefined ? { caption: edit.caption.trim() } : {}),
      ...(edit.citationKey !== undefined ? { citationKey: edit.citationKey.trim() } : {}),
    };
    return entry.image;
  }

  async imageUsage(): Promise<Record<string, ImageUse>> {
    return this.usage;
  }

  watchImages(onChange: () => void): () => void {
    this.watchers.add(onChange);
    return () => void this.watchers.delete(onChange);
  }

  async deliver(file: DeliveredFile): Promise<void> {
    this.delivered.push(file);
    this.download?.(file);
  }

  notify(message: string): void {
    this.notices.push(message);
  }
}
