// What the desktop app does for embedded web pages and videos, beyond the editor's own: asks the core whether a site lets itself be framed
// (it reads the headers a page cannot read from a frame), fetches the picture of a video, and lets the editor's frames load a page for as
// long as it plays. Every one is a command of the core; nothing here reaches the web or the vault itself.

import type { FrameVerdict, SlidesHost } from "@kasten-slides/react";
import { invoke } from "@tauri-apps/api/core";

import { allowEmbeds } from "./presenter-link";

/** What `fetch_poster` answers: the picture's kind of file and its bytes. */
interface FetchedPoster {
  ext: string;
  bytes: number[];
}

export function embedHost(): Required<Pick<SlidesHost, "framePolicy" | "fetchPoster" | "allowFrames">> {
  return {
    async framePolicy(address) {
      try {
        return await invoke<FrameVerdict>("frame_policy", { url: address });
      } catch {
        // A site that could not be asked (offline, slow) is let load: the frame's own watch tells what it can.
        return "unknown";
      }
    },
    async fetchPoster(source) {
      try {
        const got = await invoke<FetchedPoster | null>("fetch_poster", { provider: source.provider, url: source.url });
        return got ? { name: `${source.provider}-${source.id}.${got.ext}`, bytes: Uint8Array.from(got.bytes) } : null;
      } catch {
        // A poster is a nicety; the embed works without one.
        return null;
      }
    },
    async allowFrames(addresses) {
      await allowEmbeds(addresses);
      return () => void allowEmbeds([]);
    },
  };
}
