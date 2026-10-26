// Small shared pieces for the backup rows in Settings.

import type { ReactNode } from "react";

export const BUTTON = "ui-btn";
export const FIELD = "h-8 rounded-md border border-line bg-canvas px-2 text-13";

/** A typed backup error ({ kind, message }) shows its sentence. */
export const message = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
};

/** Settings' row, handed down so these rows look like every other one. `detail`
 * is a short status under the name, `help` the longer explanation behind its ?. */
export type RowComponent = (props: { label: string; detail?: ReactNode; help?: ReactNode; children: ReactNode }) => ReactNode;

/** The server an https address is on, as the keychain keeps its token. */
export function httpsOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && !parsed.username ? parsed.origin : null;
  } catch {
    return null;
  }
}
