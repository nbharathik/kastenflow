// Copying a reference to the clipboard, with a word of confirmation.

import { useWorkspace } from "../workspace/store";

/** Puts `text` on the clipboard and says `said`; says so when the clipboard is not there. */
export async function copyText(text: string, said: string): Promise<boolean> {
  const { toast } = useWorkspace.getState();
  try {
    await navigator.clipboard.writeText(text);
    toast(said);
    return true;
  } catch {
    toast("Could not copy: the clipboard is not available here");
    return false;
  }
}
