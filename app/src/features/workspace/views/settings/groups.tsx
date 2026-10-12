// What each group of Settings draws, and the small action beside its title.
// The index (index.ts) says which groups there are; this says how to draw them.

import type { ComponentType } from "react";

import { BoardsSettings } from "../../../boards/BoardsSettings";
import { BrowserSettings } from "../../../browser/BrowserSettings";
import { CalendarSettings } from "../../../calendar/CalendarSettings";
import { DiagramsSettings } from "../../../diagrams/DiagramsSettings";
import { ExtensionSettings } from "../../../extension/ExtensionSettings";
import { MeaningSettings } from "../../../meaning/MeaningSettings";
import { ShortcutSettings } from "../../../shortcuts/ShortcutSettings";
import { About } from "./About";
import { AgentSettings } from "./AgentSettings";
import { AIProviders } from "./AIProviders";
import { AppearanceSettings, ResetAppearance } from "./AppearanceSettings";
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
  search: () => <MeaningSettings />,
  diagrams: DiagramsSettings,
  templates: TemplateSettings,
  desktop: DesktopSettings,
  shortcuts: ShortcutSettings,
  about: About,
};

/** The small action at the right of a group's title, for the groups that have one. */
export const GROUP_ACTIONS: Partial<Record<GroupId, ComponentType>> = {
  appearance: ResetAppearance,
  home: ResetHome,
};
