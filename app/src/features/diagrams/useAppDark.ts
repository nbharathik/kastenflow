import { useEffect, useState } from "react";

const isDark = () => document.documentElement.dataset.theme === "dark";

/** Whether the app is in its dark theme now, following a change of theme. */
export function useAppDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(isDark()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return dark;
}
