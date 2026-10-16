// The browser tab's full screen: the window's chrome steps aside (focus mode)
// and the screen is the window's. Leaving, by the button, Escape or the system,
// gives both back; so does the tab going away.

import { useEffect, useRef, useState } from "react";

import { fillScreen } from "../../lib/fullscreen";
import { useShell } from "../../lib/store";

export function useFullScreen(): { full: boolean; toggle(): Promise<void> } {
  const [full, setFull] = useState(false);
  const leave = useRef<(() => void) | null>(null);

  const toggle = async () => {
    if (full) {
      leave.current?.();
      leave.current = null;
      useShell.setState({ focusMode: false });
      setFull(false);
      return;
    }
    useShell.setState({ focusMode: true });
    setFull(true);
    leave.current = await fillScreen(() => {
      leave.current = null;
      useShell.setState({ focusMode: false });
      setFull(false);
    });
  };

  useEffect(
    () => () => {
      if (leave.current) {
        leave.current();
        useShell.setState({ focusMode: false });
      }
    },
    [],
  );

  return { full, toggle };
}
