// The right pane of Settings: one group under its header, or, while a
// search is on, every group with a match, each showing only what was found.

import type { ComponentType } from "react";

import { Button } from "../../../../ui/Button";
import { Icon } from "../../../../ui/Icon";
import { HelpTip } from "./HelpTip";
import { GROUP_ACTIONS, GROUP_VIEWS, type GroupProps } from "./groups";
import { GROUPS, groupById, type Found, type GroupId, type GroupInfo } from "./index";
import { hasWords } from "./search";
import { IDLE, SettingsViewContext } from "./view";

function Header({ icon, title, blurb, about, Actions }: { icon: GroupInfo["icon"]; title: string; blurb: string; about?: string; Actions?: ComponentType }) {
  return (
    <header className="kasten-set-head">
      <span className="kasten-set-head-icon">
        <Icon name={icon} className="size-5" />
      </span>
      <div className="kasten-set-head-text">
        <div className="kasten-set-title-row">
          <h1 className="kasten-set-title">{title}</h1>
          {about && <HelpTip label={title}>{about}</HelpTip>}
        </div>
        <p className="kasten-set-blurb">{blurb}</p>
      </div>
      {Actions && (
        <div className="kasten-set-head-actions">
          <Actions />
        </div>
      )}
    </header>
  );
}

interface PageProps extends GroupProps {
  flash: string | null;
  open(id: string): void;
}

/** One group: its header, then what it has. */
export function GroupPage({ group, flash, open, onSwitchVault }: PageProps & { group: GroupId }) {
  const info = groupById(group);
  const View = GROUP_VIEWS[group];
  return (
    <SettingsViewContext.Provider value={{ ...IDLE, group, flash, open }}>
      <div className="kasten-set-page" data-group={group}>
        <Header icon={info.icon} title={info.title} blurb={info.blurb} about={info.about} Actions={GROUP_ACTIONS[group]} />
        <div className="kasten-set-content">
          <View onSwitchVault={onSwitchVault} />
        </div>
      </div>
    </SettingsViewContext.Provider>
  );
}

/** The element id of a group's block of search results. */
export const resultsId = (group: GroupId) => `settings-results-${group}`;

/** What a search found, group by group, with the words marked. */
export function Results({ found, query, words, flash, open, onSwitchVault, onClear }: PageProps & { found: Found; query: string; words: readonly string[]; onClear(): void }) {
  // Groups named by the words come first, the rest in the navigation's order.
  const named = (g: GroupInfo) => hasWords(words, g.title);
  const groups = GROUPS.filter((g) => (found.byGroup.get(g.id) ?? 0) > 0).sort((a, b) => Number(named(b)) - Number(named(a)));
  const blurb = found.total === 0 ? "Nothing found" : `${found.total} ${found.total === 1 ? "setting" : "settings"} in ${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
  return (
    <div className="kasten-set-page" data-group="results">
      <Header icon="search" title="Search results" blurb={blurb} />
      <div className="kasten-set-content">
        {found.total === 0 ? (
          <div className="kasten-set-empty" role="status">
            <p>No settings match “{query.trim()}”</p>
            <Button size="sm" icon="close" onClick={onClear}>
              Clear search
            </Button>
          </div>
        ) : (
          groups.map((g) => {
            const View = GROUP_VIEWS[g.id];
            return (
              <SettingsViewContext.Provider key={g.id} value={{ group: g.id, words, matching: found.ids, flash, open }}>
                <section id={resultsId(g.id)} aria-label={`${g.title} results`} className="kasten-set-result">
                  <h2 className="kasten-set-result-head">
                    <Icon name={g.icon} className="size-4" />
                    {g.title}
                  </h2>
                  <View onSwitchVault={onSwitchVault} />
                </section>
              </SettingsViewContext.Provider>
            );
          })
        )}
      </div>
    </div>
  );
}
