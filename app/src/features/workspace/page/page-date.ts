// A date on any page: the page's `date` property (what the Calendar shows it
// by, with or without a tag's schema), set from an `@` typed in its title and
// shown as a chip beside the title. Written with the core's `update_props`.

import type { NoteMeta } from "../../../lib/vault/types";
import { asDay } from "../../calendar/dates";
import { editFrontmatter, type PanelPage } from "../../panel/page-edit";
import type { PageHeaderProps } from "../../pages/page/PageHeader";
import { usePrefs } from "../prefs";

/** The date props of the page header for `note`; without `editable` the chip shows but nothing sets it. */
export function pageDateProps(note: NoteMeta, page: PanelPage, editable: boolean): Pick<PageHeaderProps, "date" | "onDate" | "weekStart"> {
  return {
    date: asDay(note.props.date),
    weekStart: () => usePrefs.getState().weekStart,
    ...(editable && { onDate: (day: string | null) => void editFrontmatter(page, () => page.client.updateProps(note.path, { date: day })) }),
  };
}
