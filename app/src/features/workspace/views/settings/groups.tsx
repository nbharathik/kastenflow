// What each group of Settings draws, and the small action beside its title.
// The index (index.ts) says which groups there are; this says how to draw them.

import type { ComponentType, ReactNode } from "react";

import { BoardsSettings } from "../../../boards/BoardsSettings";
import { BrowserSettings } from "../../../browser/BrowserSettings";
import { CalendarSettings } from "../../../calendar/CalendarSettings";
import { DiagramsSettings } from "../../../diagrams/DiagramsSettings";
import { ExtensionSettings } from "../../../extension/ExtensionSettings";
import { MeaningSettings } from "../../../meaning/MeaningSettings";
import { ShortcutSettings } from "../../../shortcuts/ShortcutSettings";
import { settingsSections } from "../../../../plugins/contributions";
import { usePluginOff } from "../../../../plugins/off";
import { PluginOffNote } from "../../../../plugins/OffView";
import { PluginsSettings } from "../../../../plugins/PluginsSettings";
import { usePluginsVersion } from "../../../../plugins/registry";
import { About } from "./About";
import { AgentSettings } from "./AgentSettings";
import { AIProviders } from "./AIProviders";
import { AppearanceSettings, ResetAppearance } from "./AppearanceSettings";
import { BackupSettings } from "./BackupSettings";
import { DesktopSettings } from "./DesktopSettings";
import { HomeSettings, ResetHome } from "./HomeSettings";
import type { GroupId } from "./index";
import { PageSettings } from "./PageSettings";
import { SidebarSettings } from "./SidebarSettings";
import { TemplateSettings } from "./TemplateSettings";
import { HistorySettings, VaultSettings } from "./VaultSettings";

/** What a group's page may ask of the window around it. */
export interface GroupProps {
  /** Opens the vault chooser, in place of Settings. */
  onSwitchVault(): void;
}

/** A group a plugin draws: its section while the plugin is on; `fallback` (the plugin not loaded) keeps the group's rows on the page, which the index lists either way. */
function PluginSection({ plugin, fallback: Fallback, off }: { plugin: string; fallback: ComponentType; off: ReactNode }) {
  usePluginsVersion();
  const isOff = usePluginOff(plugin);
  // A plugin that is off says so, with the button that turns it on, in place of its rows.
  if (isOff) return <PluginOffNote plugin={plugin}>{off}</PluginOffNote>;
  const Section = settingsSections().find((s) => s.plugin === plugin)?.render ?? Fallback;
  return <Section />;
}

export const GROUP_VIEWS: Record<GroupId, ComponentType<GroupProps>> = {
  appearance: AppearanceSettings,
  pages: PageSettings,
  sidebar: SidebarSettings,
  home: HomeSettings,
  boards: BoardsSettings,
  ai: AIProviders,
  agents: AgentSettings,
  calendar: CalendarSettings,
  browser: BrowserSettings,
  extension: () => <ExtensionSettings />,
  vault: ({ onSwitchVault }) => <VaultSettings onSwitch={onSwitchVault} />,
  history: HistorySettings,
  backup: BackupSettings,
  search: () => <MeaningSettings />,
  diagrams: () => <PluginSection plugin="diagrams" fallback={DiagramsSettings} off="Diagrams are off. Your diagram files stay in the vault and their pictures still show in pages, slides and whiteboards; turn on draw.io to draw and change them." />,
  templates: TemplateSettings,
  plugins: () => <PluginsSettings />,
  desktop: DesktopSettings,
  shortcuts: ShortcutSettings,
  about: About,
};

/** The small action at the right of a group's title, for the groups that have one. */
export const GROUP_ACTIONS: Partial<Record<GroupId, ComponentType>> = {
  appearance: ResetAppearance,
  home: ResetHome,
};
