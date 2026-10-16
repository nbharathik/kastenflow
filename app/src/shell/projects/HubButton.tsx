import { keyTitle } from "../../features/shortcuts/store";
import { howFrom } from "../../features/workspace/store";
import { Icon } from "../../ui/Icon";
import { openView, useActive } from "../NavRow";

/** A small grid icon beside the Projects heading: opens the Projects hub, as the
 * rows above it open their views (Ctrl, Shift and Alt, or the middle button, open it in a tab, the stack or beside). */
export function ProjectsHubButton() {
  const active = useActive("projects");
  return (
    <button
      type="button"
      aria-label="All projects"
      title={keyTitle("All projects", "projects")}
      aria-current={active ? "page" : undefined}
      onClick={(event) => openView("projects", howFrom(event))}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        openView("projects", "tab");
      }}
      className={`mr-0.5 grid size-5 place-items-center rounded-md transition-colors ${active ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
    >
      <Icon name="gallery" className="size-3.5" />
    </button>
  );
}
