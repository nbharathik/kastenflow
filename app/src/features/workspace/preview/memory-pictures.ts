// The pictures of the browser preview's vault: the client's part for the gallery
// (commands/assets.rs), on the pictures kept in memory (memory-assets.ts).

import type { AddedAsset, AssetEdit, AssetInfo, AssetUsage, NewAsset } from "../../../lib/vault/asset-types";
import { MemoryAssets, documentsOf, isAssetPath } from "./memory-assets";
import { MemoryKits } from "./memory-kits";

export class MemoryPictures extends MemoryKits {
  /** Kept in memory for this session only: files are too big for the
   * preview's local storage. */
  private pictures = new MemoryAssets();

  protected override keeps(file: string): boolean {
    return this.pictures.has(file) || super.keeps(file);
  }

  async saveAsset(name: string, bytes: Uint8Array): Promise<string> {
    return (await this.addAsset(name, bytes)).path;
  }

  async addAsset(name: string, bytes: Uint8Array, meta: NewAsset = {}): Promise<AddedAsset> {
    return this.pictures.add(name, bytes, meta, "person", this.now());
  }

  async readAsset(path: string): Promise<Uint8Array> {
    const bytes = this.pictures.bytesOf(path);
    if (!bytes) throw new Error(`There is no picture at ${path}`);
    return bytes;
  }

  async assets(): Promise<AssetInfo[]> {
    return this.pictures.list();
  }

  async asset(path: string): Promise<AssetInfo> {
    return this.pictures.get(path);
  }

  async setAssetMeta(path: string, edit: AssetEdit): Promise<AssetInfo> {
    return this.pictures.setMeta(path, edit);
  }

  /** The preview makes no thumbnails: the original is shown. */
  async assetThumb(_path: string, _size: 256 | 1024): Promise<Uint8Array | undefined> {
    return undefined;
  }

  async assetsUsage(): Promise<Record<string, AssetUsage>> {
    const { notes, boards, decks } = documentsOf(this.data, await this.list());
    return this.pictures.usage(notes, boards, decks);
  }

  async assetUsage(path: string): Promise<AssetUsage> {
    if (!isAssetPath(path)) throw new Error(`Not a path in assets/: ${path}`);
    return (await this.assetsUsage())[path] ?? { notes: [], boards: [], decks: [] };
  }
}
