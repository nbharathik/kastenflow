// Settings → Home: which sections the Home page shows. The same choice as
// Customize on Home; the order is arranged there.

import { Button } from "../../../../ui/Button";
import { sameList, toggled } from "../../../dashboard/sections";
import { HOME_DEFAULT, HOME_SECTIONS, homeSections, type HomeSection } from "../../../home/sections";
import { usePrefs } from "../../prefs";
import { Group, Switch } from "./parts";

const choose = (next: HomeSection[]) => usePrefs.getState().set({ homeSections: sameList(next, HOME_DEFAULT) ? null : next });

/** The header's way back: the sections Home starts with, in their order. */
export function ResetHome() {
  const saved = usePrefs((s) => s.homeSections);
  return (
    <Button size="sm" icon="undo" disabled={saved === null} onClick={() => usePrefs.getState().set({ homeSections: null })}>
      Back to the usual
    </Button>
  );
}

export function HomeSettings() {
  const shown = homeSections(usePrefs((s) => s.homeSections));
  return (
    <Group title="Home">
      {HOME_SECTIONS.map((section) => (
        <Switch
          key={section.id}
          id={`home.${section.id}`}
          icon={section.icon}
          usual={HOME_DEFAULT.includes(section.id)}
          checked={shown.includes(section.id)}
          onChange={(on) => on !== shown.includes(section.id) && choose(toggled(shown, section.id, HOME_SECTIONS))}
        />
      ))}
    </Group>
  );
}
