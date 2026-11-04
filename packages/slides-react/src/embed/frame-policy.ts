// Asking the host whether a site lets itself be shown in a frame. A page cannot find that out from its frame (the error page the browser
// puts in a refused frame still "loads"), but the host can read the headers the site answers with. A site that refuses gets its card
// at once, and no frame is made for it. The answer is kept for the life of the page, so a slide that is shown again asks nothing.

import { useEffect, useState } from "react";

import type { FrameVerdict } from "../editor/host.ts";
import { isLocalAddress } from "../present/web-frame.ts";
import type { EmbedLink } from "./embed-url.ts";

export type FramePolicy = (address: string) => Promise<FrameVerdict>;

const kept = new WeakMap<FramePolicy, Map<string, FrameVerdict>>();

/** Whether the host is worth asking about this link: a site with an embed of its own (a player) is made to be framed, and a page on this computer is the person's own. */
function worthAsking(link: EmbedLink | null, address: string | null): address is string {
  return link !== null && link.provider === "web" && address !== null && !isLocalAddress(address);
}

/** True once the host has said that the page at `address` refuses to be shown in a frame. */
export function useFrameRefused(policy: FramePolicy | undefined, link: EmbedLink | null, address: string | null): boolean {
  const [refused, setRefused] = useState<{ address: string; yes: boolean } | null>(null);

  useEffect(() => {
    if (!policy || !worthAsking(link, address)) return;
    const known = kept.get(policy)?.get(address);
    if (known !== undefined) {
      setRefused({ address, yes: known === "refused" });
      return;
    }
    let current = true;
    policy(address).then(
      (verdict) => {
        // "unknown" is not kept: the network may be back by the next look.
        if (verdict !== "unknown") {
          const table = kept.get(policy) ?? new Map<string, FrameVerdict>();
          table.set(address, verdict);
          kept.set(policy, table);
        }
        if (current) setRefused({ address, yes: verdict === "refused" });
      },
      () => {
        // A host that cannot say leaves the frame to show what it can.
      },
    );
    return () => {
      current = false;
    };
  }, [policy, link?.provider, address]);

  return refused !== null && refused.address === address && refused.yes;
}
