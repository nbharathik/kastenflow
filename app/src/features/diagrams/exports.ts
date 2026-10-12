// Taking a diagram's picture out of Kasten: as an SVG file (the picture kept
// beside the source), as a PNG the editor draws, or as an image on the
// clipboard.

import type { VaultClient } from "../../lib/vault/types";
import { stemOfPath } from "./names";
import { bytesOfDataUri, exportPng } from "./protocol";
import type { DrawioSession } from "./session";

/** A PNG of the diagram as the open editor shows it, at 2x; null when the editor does not answer. */
export async function pngOf(session: DrawioSession): Promise<Uint8Array | null> {
  const answer = await session.ask(exportPng(2), 10_000);
  return answer ? bytesOfDataUri(answer.data) : null;
}

/** Hands the picture to the person as `<name>.svg`: after what is waiting is written, so it is the picture of what they see. */
export async function downloadSvg(client: VaultClient, path: string, session: DrawioSession | null): Promise<string> {
  await session?.flush();
  const svg = await client.diagramPreview(path);
  if (!svg) throw new Error("This diagram has no picture yet; open it in the editor first");
  return client.saveDownload(`${stemOfPath(path)}.svg`, new TextEncoder().encode(svg), "image/svg+xml");
}

/** Hands a PNG of the diagram to the person as `<name>.png`. */
export async function downloadPng(client: VaultClient, path: string, session: DrawioSession): Promise<string> {
  const bytes = await pngOf(session);
  if (!bytes) throw new Error("The editor did not draw the picture; try again");
  return client.saveDownload(`${stemOfPath(path)}.png`, bytes, "image/png");
}

/** Puts a PNG of the diagram on the clipboard, to paste where an image goes. */
export async function copyPng(session: DrawioSession): Promise<void> {
  const bytes = await pngOf(session);
  if (!bytes) throw new Error("The editor did not draw the picture; try again");
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("This window cannot copy an image");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes as BlobPart], { type: "image/png" }) })]);
}
