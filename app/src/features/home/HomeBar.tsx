// The top of Home, on one line: the greeting and the date, the capture field,
// "+ New" and Customize.

import { Customize } from "../dashboard/Customize";
import { sameList } from "../dashboard/sections";
import { usePrefs } from "../workspace/prefs";
import { CaptureBar } from "./CaptureBar";
import { NewMenu } from "./NewMenu";
import { HOME_DEFAULT, HOME_SECTIONS, type HomeSection } from "./sections";

export function greeting(hour = new Date().getHours()): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

export function HomeBar({ sections }: { sections: readonly HomeSection[] }) {
  return (
    <header className="kasten-home-bar">
      <div className="kasten-home-hello">
        <h1>{greeting()}</h1>
        <p>{today()}</p>
      </div>
      <CaptureBar />
      <div className="kasten-home-actions">
        <NewMenu />
        <Customize
          label="Home"
          defs={HOME_SECTIONS}
          sections={sections}
          defaults={HOME_DEFAULT}
          resetLabel="Reset to the simple layout"
          onChange={(next) => usePrefs.getState().set({ homeSections: sameList(next, HOME_DEFAULT) ? null : next })}
        />
      </div>
    </header>
  );
}
