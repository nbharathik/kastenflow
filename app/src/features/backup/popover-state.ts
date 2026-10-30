// Whether the backup status popover is open, so the palette and a notice can
// open it as well as the status bar's button.

import { create } from "zustand";

export const useBackupPopover = create<{ open: boolean }>()(() => ({ open: false }));
